"""Small opt-in real-provider/PostgreSQL quality check using only authored disposable fixtures."""

import io
import json
import os
import time
from pathlib import Path
from uuid import uuid4
import httpx
from reportlab.pdfgen import canvas
from .config import settings
from .db import engine, SessionLocal
from .models import Question


def wait(check, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.3)
    raise AssertionError("Timed out waiting for actual fixture processing.")


def main():
    if os.getenv("RUN_OPENAI_SMOKE") != "1":
        raise SystemExit("Set RUN_OPENAI_SMOKE=1 to authorise real provider calls for this check.")
    if engine.dialect.name != "postgresql":
        raise SystemExit("Run this check against the local Compose PostgreSQL stack.")
    cases = json.loads(Path(__file__).with_name("quality_cases.json").read_text())
    base = os.getenv("QUALITY_BASE_URL", "http://api:8000/api/v1")
    suffix = uuid4().hex
    outcomes = []
    with httpx.Client(base_url=base, timeout=35) as teacher, httpx.Client(base_url=base, timeout=35) as student:
        for client, role in [(teacher, "lecturer"), (student, "student")]:
            response = client.post(
                "/auth/register",
                json={
                    "name": f"Quality fixture {role}",
                    "email": f"quality-{role}-{suffix}@example.com",
                    "password": "authored-quality-fixture-password",
                    "role": role,
                },
            )
            response.raise_for_status()
        response = teacher.post("/courses", json={"name": f"Semantic quality fixture {suffix}"})
        response.raise_for_status()
        cid = response.json()["id"]
        try:
            teacher.post(
                f"/courses/{cid}/members", json={"email": f"quality-student-{suffix}@example.com"}
            ).raise_for_status()
            resource_ids = {}
            for name, text in cases["resources"].items():
                response = teacher.post(
                    f"/courses/{cid}/resources", files={"file": (name, text.encode(), "text/plain")}
                )
                response.raise_for_status()
                resource_ids[name] = response.json()["id"]
            output = io.BytesIO()
            deck = canvas.Canvas(output, pagesize=(960, 540))
            deck.drawString(60, 440, "Authored semantic quality fixture")
            deck.save()
            response = teacher.post(
                f"/courses/{cid}/resources", files={"file": ("quality-deck.pdf", output.getvalue(), "application/pdf")}
            )
            response.raise_for_status()
            rid = response.json()["id"]

            def ready(identifier):
                data = teacher.get(f"/resources/{identifier}").json()
                return data.get("extraction_status") == "ready" and data.get("index_status") == "ready"

            wait(lambda: all(ready(identifier) for identifier in [rid, *resource_ids.values()]))
            for case in cases["search"]:
                started = time.monotonic()
                response = student.get(f"/courses/{cid}/search", params={"q": case["query"]})
                response.raise_for_status()
                data = response.json()
                assert not data["warnings"], data["warnings"]
                ids = {group["source_id"] for group in data["matches"]}
                assert resource_ids[case["include"]] in ids, case["name"]
                assert not ids & {resource_ids[name] for name in case["exclude"]}, case["name"]
                outcomes.append({"case": case["name"], "seconds": round(time.monotonic() - started, 2)})
                print(f"PASS search: {case['name']}", flush=True)

            def start(title):
                response = teacher.post(f"/courses/{cid}/lectures", json={"title": title, "slide_resource_id": rid})
                response.raise_for_status()
                response = teacher.post(
                    f"/lectures/{response.json()['id']}/sessions/start", json={"recording_enabled": False}
                )
                response.raise_for_status()
                return response.json()["id"]

            sid = start("Authored feedback checks")
            response = teacher.post(f"/sessions/{sid}/polls", json={})
            response.raise_for_status()
            pid = response.json()["id"]
            for case in cases["feedback"]:
                started = time.monotonic()
                student.post(f"/polls/{pid}/feedback", json={"text": case["text"]}).raise_for_status()

                def classified():
                    data = teacher.get(f"/sessions/{sid}/lecturer-queue").json()
                    return next(
                        (
                            note
                            for note in data["feedback"]
                            if note["text_original"] == case["text"] and note.get("processing_status")
                        ),
                        None,
                    )

                note = wait(classified)
                with SessionLocal() as db:
                    from .models import Feedback

                    analysis = db.get(Feedback, note["id"]).analysis_json
                assert note["processing_status"] == "complete", (
                    f"Whole-note accounting failed: {case['name']}: {analysis.get('issues', [])}"
                )
                assert note["text_original"] == case["text"]
                if case["requests"]:
                    question = teacher.get(f"/questions/{note['linked_question_id']}").json()
                    assert all(term in question["text"].casefold() for term in case["contains"]), case["name"]
                    assert student.get(f"/questions/{note['linked_question_id']}").status_code == 404
                    with SessionLocal() as db:
                        saved = db.get(Question, note["linked_question_id"])
                        assert saved.course_id == cid and saved.visibility == "private"
                        assert len(saved.request_parts) == case["requests"], case["name"]
                else:
                    assert (
                        note["classification"] == "feedback" and not note["ai_modified"] and not note["text_rewritten"]
                    )
                outcomes.append({"case": case["name"], "seconds": round(time.monotonic() - started, 2)})
                print(f"PASS feedback: {case['name']}", flush=True)
            teacher.post(f"/sessions/{sid}/end").raise_for_status()
            for case in cases["grouping"]:
                started = time.monotonic()
                sid = start("Authored grouping: " + case["name"])
                ids = []
                for text in case["questions"]:
                    payload = {"text": text, "session_id": sid, "submission_id": str(uuid4())}
                    response = student.post(f"/courses/{cid}/questions/preflight", json=payload)
                    response.raise_for_status()
                    response = student.post(
                        f"/courses/{cid}/questions",
                        json={**payload, "preflight_token": response.json()["preflight_token"]},
                    )
                    response.raise_for_status()
                    ids.append(response.json()["id"])

                    # Wait between members so this also exercises adding to an existing auto group.
                    def grouped():
                        data = teacher.get(f"/sessions/{sid}/lecturer-queue").json()
                        return (
                            data
                            if not any(
                                job["type"] == "group_questions" and job["status"] in {"queued", "processing"}
                                for job in data["ai_jobs"]
                            )
                            else None
                        )

                    data = wait(grouped)
                    failures = [
                        job.get("error")
                        for job in data["ai_jobs"]
                        if job["type"] == "group_questions" and job["status"] == "failed"
                    ]
                    assert not failures, (case["name"], failures)
                groups = {frozenset(question["id"] for question in group["questions"]) for group in data["groups"]}
                expected = {frozenset(ids[index] for index in group) for group in case["groups"]}
                assert groups == expected, case["name"]
                assert {question["id"] for group in data["groups"] for question in group["questions"]} == set(ids)
                teacher.post(f"/sessions/{sid}/end").raise_for_status()
                outcomes.append({"case": case["name"], "seconds": round(time.monotonic() - started, 2)})
                print(f"PASS grouping: {case['name']}", flush=True)
            print(
                json.dumps(
                    {
                        "version": cases["version"],
                        "database": "PostgreSQL",
                        "text_model": settings().openai_text_model,
                        "embedding_model": settings().openai_embed_model,
                        "passed": len(outcomes),
                        "cases": outcomes,
                    }
                ),
                flush=True,
            )
        finally:
            response = teacher.delete(f"/courses/{cid}")
            response.raise_for_status()
            print("Removed exact authored fixture course.", flush=True)


if __name__ == "__main__":
    main()
