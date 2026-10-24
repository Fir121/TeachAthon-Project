"""Opt-in BSL demo: persisted final captions only, course/student authorization first."""

import hashlib
import re
import time
from collections import OrderedDict
from pathlib import Path
from threading import Lock
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .classroom import live
from .config import settings
from .models import Transcript
from .security import DB, Actor

router = APIRouter()
ASSETS = Path(__file__).with_name("bsl_assets")
CACHE = OrderedDict()
LOCK = Lock()
RATES = OrderedDict()
RATE_LOCK = Lock()
LOCAL = {"panel.html", "panel.js", "panel.css", "test.html", "test.js", "test.css", "credits.txt"}
REMOTE = {
    "cwa/allcsa.js",
    "cwa/cwasa.css",
    "cwa/cwacfg.json",
    "data/hamnosys_bsl_version1.sigml",
    "cwa/avatars/anna.jar",
}
REMOTE |= {"cwa/h2s.xsl", "cwa/shaders/qskin.vert", "cwa/shaders/qskin.frag", "cwa/avatars/COMMON.jar"}
CSP = (
    "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; script-src-attr 'unsafe-inline'; "
    "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'self'"
)
HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": CSP,
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def student_session(db, sid, user):
    session, membership = live(db, sid, user)
    if membership.role != "student":
        raise HTTPException(403, "The experimental avatar is a student opt-in feature.")
    return session


def enabled():
    if not settings().bsl_enabled:
        raise HTTPException(503, "BSL renderer is not enabled. Live captions remain available.")


def internal(path, data=None, headers=None, method="GET"):
    try:
        with httpx.Client(timeout=5, follow_redirects=False, trust_env=False) as client:
            url = settings().bsl_kozha_url.rstrip("/") + path
            r = client.request(method, url, headers=headers) if data is None else client.post(url, json=data)
            r.raise_for_status()
            if len(r.content) > 20_000_000:
                raise ValueError("oversized asset")
            return r
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, "BSL service unavailable. Use live captions and retry.") from None


def split_caption(text):
    """Stable bounded text segments; all retain original input-window timestamps."""
    return re.findall(r".{1,180}(?:\s+|$)|\S{1,180}", text.strip(), flags=re.DOTALL)


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caption_id: UUID
    part: int = Field(default=0, ge=0, le=31)


class GlossPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    glosses: list[str] = Field(max_length=24)
    missing: list[str] = Field(max_length=180)
    supported: bool
    planner: str = Field(max_length=200)


@router.get("/api/v1/sessions/{sid}/bsl/config")
def config(sid: str, db: DB, user: Actor):
    student_session(db, sid, user)
    return {"enabled": settings().bsl_enabled, "max_queue": 3, "max_age_ms": 15000}


@router.post("/api/v1/sessions/{sid}/bsl/plan")
def plan(sid: str, data: PlanInput, db: DB, user: Actor):
    student_session(db, sid, user)
    enabled()
    caption = db.get(Transcript, str(data.caption_id))
    if not caption or str(caption.session_id) != sid:
        raise HTTPException(404, "Final caption not found in this session.")
    parts = split_caption(caption.text)
    if len(parts) > 32 or data.part >= len(parts):
        raise HTTPException(422, "Caption segment unavailable; use captions.")
    text = parts[data.part].strip()
    key = (sid, str(caption.id), data.part, hashlib.sha256(text.encode()).hexdigest())
    # Bounded per-user rate and one in-flight planner across students. Cache coalesces duplicates.
    now = time.monotonic()
    with RATE_LOCK:
        hits = [t for t in RATES.pop(user.id, []) if t > now - 60]
        RATES[user.id] = hits
        if len(hits) >= 60:
            raise HTTPException(429, "Signing is catching up. Continue with captions.")
        RATES[user.id] = hits + [now]
        while len(RATES) > 1024:
            RATES.popitem(last=False)
    if not LOCK.acquire(timeout=6):
        raise HTTPException(503, "Signing planner busy. Continue with captions.")
    try:
        cached = CACHE.get(key)
        if cached and cached[0] > now - 300:
            result = cached[1]
        else:
            try:
                raw = internal("/plan", {"text": text}).json()
                checked = GlossPlan.model_validate(raw)
                if any(not g or len(g) > 100 for g in checked.glosses + checked.missing):
                    raise ValueError("invalid gloss")
                if checked.supported != bool(checked.glosses) or (checked.supported and checked.missing):
                    raise ValueError("invalid coverage")
                result = checked.model_dump()
            except (ValueError, TypeError):
                raise HTTPException(503, "BSL planning failed. Continue with captions.") from None
            CACHE[key] = (time.monotonic(), result)
            while len(CACHE) > 256:
                CACHE.popitem(last=False)
    finally:
        LOCK.release()
    db.expire_all()
    student_session(db, sid, user)
    return {
        **result,
        "caption_id": str(caption.id),
        "part": data.part,
        "parts": len(parts),
        "text": text,
        "start_ms": caption.start_ms,
        "end_ms": caption.end_ms,
    }


@router.get("/api/v1/sessions/{sid}/bsl/demo")
def demo(sid: str, db: DB, user: Actor):
    student_session(db, sid, user)
    enabled()
    result = internal("/demo").json()
    # Local curated bridge owns this input; never forward arbitrary browser gloss/SiGML.
    if not isinstance(result, dict) or len(result.get("cues", [])) != 3:
        raise HTTPException(503, "Prepared script unavailable.")
    return result


@router.head("/api/v1/sessions/{sid}/bsl/assets/{path:path}", include_in_schema=False)
@router.get("/api/v1/sessions/{sid}/bsl/assets/{path:path}")
def asset(sid: str, path: str, request: Request, db: DB, user: Actor):
    student_session(db, sid, user)
    enabled()
    if path == "panel.html" and request.headers.get("sec-fetch-dest") != "iframe":
        raise HTTPException(403, "Open the avatar from the student panel or corpus test.")
    if path in LOCAL:
        return FileResponse(ASSETS / path, headers=HEADERS)
    if path not in REMOTE:
        raise HTTPException(404, "BSL asset not found.")
    r = internal(
        "/assets/" + path,
        headers={"Range": request.headers["range"]} if "range" in request.headers else None,
        method=request.method,
    )
    media = {
        "js": "text/javascript",
        "css": "text/css",
        "json": "application/json",
        "xsl": "application/xml",
        "vert": "text/plain",
        "frag": "text/plain",
        "sigml": "application/xml",
        "jar": "application/java-archive",
    }[path.rsplit(".", 1)[-1]]
    headers = {
        **HEADERS,
        **{k: v for k, v in r.headers.items() if k in {"content-range", "content-length", "accept-ranges"}},
    }
    return Response(r.content, status_code=r.status_code, media_type=media, headers=headers)
