"""Restricted internal Kozha adapter. No STT, authoring, OpenAI keys, or public port."""

import csv
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from server import process_text, LANG_MODELS

ROOT = Path("/opt/kozha")
# Refuse upstream's silent blank-spaCy fallback: it is not a working planner.
assert LANG_MODELS["en"].has_pipe("tagger") and LANG_MODELS["en"].has_pipe("lemmatizer")
SIGNS = {
    s.attrib["gloss"].lower(): s
    for s in ET.parse(ROOT / "data/hamnosys_bsl_version1.sigml").iter("hns_sign")
}
CONCEPTS = {}
for row in csv.DictReader((ROOT / "data/hamnosys_bsl.csv").open()):
    gloss = row["gloss"].lower()
    if gloss in SIGNS:
        CONCEPTS.setdefault(row["concept"].lower(), gloss)
# As in Kozha panel.resolveGloss, corpus labels may include grammatical/variant suffixes.
for gloss in SIGNS:
    CONCEPTS.setdefault(gloss.split("(")[0].strip(), gloss)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=180)


@app.get("/health")
def health():
    return {"ready": True, "signs": len(SIGNS)}


@app.post("/plan")
def plan(data: PlanInput):
    tokens = [
        t.lower() for t in process_text(data.text, "en", "bsl").split() if t != "."
    ]
    missing = [t for t in tokens if t not in SIGNS and t not in CONCEPTS]
    glosses = [
        t if t in SIGNS else CONCEPTS[t] for t in tokens if t in SIGNS or t in CONCEPTS
    ]
    # Never silently replace missing vocabulary with fingerspelling/partial meaning.
    return {
        "glosses": glosses if not missing and len(glosses) <= 24 else [],
        "missing": missing,
        "supported": bool(glosses) and not missing and len(glosses) <= 24,
        "planner": "Kozha rule-based English/BSL; unvalidated grammar",
    }


# Authored lecture vocabulary exercise, not a claim of fluent sentence translation.
DEMO = [
    {
        "text": "Today: school, teacher, student.",
        "concepts": ["today", "school", "teacher", "student"],
    },
    {"text": "Read a book.", "concepts": ["read", "book"]},
    {"text": "Ask a question.", "concepts": ["ask", "question"]},
]
for cue in DEMO:
    cue["glosses"] = [CONCEPTS[c] for c in cue.pop("concepts")]


@app.get("/demo")
def demo():
    return {
        "cues": DEMO,
        "notice": "Prepared corpus-sign vocabulary script, not live translation or fluent BSL.",
    }


@app.api_route("/assets/{path:path}", methods=["GET", "HEAD"])
def asset(path: str):
    allowed = {
        "cwa/allcsa.js",
        "cwa/cwasa.css",
        "cwa/cwacfg.json",
        "data/hamnosys_bsl_version1.sigml",
    }
    allowed.add("cwa/avatars/anna.jar")
    support = {
        "cwa/h2s.xsl",
        "cwa/shaders/qskin.vert",
        "cwa/shaders/qskin.frag",
        "cwa/avatars/COMMON.jar",
    }
    if path in support:
        name = "avatars/COMMON.jar" if path.endswith("COMMON.jar") else path
        return FileResponse(Path("/opt/cwasa-support") / name)
    if path not in allowed:
        raise HTTPException(404)
    file = ROOT / ("extension/" + path if path.startswith("cwa/") else path)
    return FileResponse(file)
