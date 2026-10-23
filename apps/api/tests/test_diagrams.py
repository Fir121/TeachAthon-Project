"""Auth, lifecycle, multimodal and isolation regressions; all provider fixtures are test-only."""

import asyncio
import json
from uuid import uuid4
import pytest
from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from conftest import signup
from app.config import settings
from app.models import Resource, DiagramRevision, DiagramAnalysis, Job, Membership, Lecture
from app.ai import diagrams as ai
from app import diagrams as routes
from app.diagram_render import validate_artifact
from app.ai.providers.openai import OpenAIVision

SAFE = {
    "title": "Halving intervals",
    "summary": "See how halving reduces a search interval.",
    "instructions": "Adjust the step count and compare the remaining candidates.",
    "accessibility_description": "Remaining interval size is also written as a number.",
    "html": '<label for="step">Steps</label><input id="step" type="range" min="0" max="8" value="0"><output id="size">256</output><button id="reset">Reset</button>',
    "css": "body{padding:12px} input{width:100%}",
    "javascript": "const step=document.querySelector('#step'),size=document.querySelector('#size');step.addEventListener('input',()=>size.textContent=String(256/2**Number(step.value)));document.querySelector('#reset').addEventListener('click',()=>{step.value='0';size.textContent='256';});",
}


RESPONSIVE = {
    **SAFE,
    "html": '<div id="ll-diagram" data-layout="responsive-v2"><section data-region="visual"><svg viewBox="0 0 400 240" role="img" aria-label="Remaining interval"><rect x="20" y="80" width="360" height="80" fill="#1c584b"></rect></svg></section><section data-region="controls">'
    + SAFE["html"]
    + "</section></div>",
}


@pytest.fixture
def prep(clients, tmp_path, monkeypatch):
    t, s, o, factory = clients
    monkeypatch.setattr(settings(), "media_root", str(tmp_path))
    signup(t)
    student = signup(s, "student", "student@example.com")
    signup(o, "student", "outsider@example.com")
    cid = t.post("/api/v1/courses", json={"name": "Diagram course"}).json()["id"]
    t.post(f"/api/v1/courses/{cid}/members", json={"email": "student@example.com"})
    for i in range(8):
        Image.new("RGB", (160, 100), (i * 25, 40, 180)).save(tmp_path / f"{i}.png")
    with factory() as db:
        r = Resource(
            course_id=cid,
            original_filename="authored.pdf",
            storage_key="test.pdf",
            content_type="application/pdf",
            size_bytes=10,
            sha256="test",
            kind="pdf",
            process_status="ready",
            pages=[{"image": f"{i}.png", "text": "Binary search halves intervals"} for i in range(8)],
        )
        db.add(r)
        db.commit()
        rid = r.id
    lid = t.post(f"/api/v1/courses/{cid}/lectures", json={"title": "Intervals", "slide_resource_id": rid}).json()["id"]
    return t, s, o, factory, cid, lid, rid, student["id"], tmp_path


def generated(prep, monkeypatch, index=0):
    t, _, _, factory, _, lid, *_ = prep

    async def provider(*args, **kwargs):
        return validate_artifact(RESPONSIVE)

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", provider)
    response = t.post(
        f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": index}
    )
    assert response.status_code == 202, response.text
    did = response.json()["id"]
    with factory() as db:
        r = db.get(DiagramRevision, did)
        job = db.get(Job, r.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        ai.generation_job(db, job)
        job.status = "ready"
        db.commit()
    return did


def frame(client, did):
    return client.get(
        f"/api/v1/diagrams/{did}/render?viewer={uuid4()}",
        headers={"sec-fetch-dest": "iframe", "sec-fetch-site": "same-origin"},
    )


def test_manual_generation_and_publication_permissions(prep, monkeypatch):
    t, s, o, factory, cid, lid, _, student, _ = prep
    # No opportunity analysis exists: any slide can be generated manually.
    did = generated(prep, monkeypatch, 1)
    path = f"/api/v1/lectures/{lid}/diagrams"
    assert s.get(path + "/preparation").status_code == 403
    assert o.get(path + "/preparation").status_code == 404
    for client, code in [(s, 403), (o, 404)]:
        assert client.post(path + "/analyse").status_code == code
        assert client.post(path + "/generate", json={"request_id": str(uuid4()), "slide_index": 0}).status_code == code
        assert client.post(f"/api/v1/diagrams/{did}/approve").status_code == code
        assert client.get(f"/api/v1/diagrams/{did}/preview").status_code == code
    assert frame(s, did).status_code == 404
    assert frame(o, did).status_code == 404
    assert t.get(f"/api/v1/diagrams/{did}/render?viewer={uuid4()}").status_code == 403
    preview = t.get(f"/api/v1/diagrams/{did}/preview").json()
    assert "html" not in json.dumps(preview)
    response = frame(t, did)
    assert response.status_code == 200
    assert "sandbox allow-scripts" in response.headers["content-security-policy"]
    assert "connect-src 'none'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"].startswith("private, no-store")
    assert "Halving intervals" in response.text
    assert t.post(f"/api/v1/diagrams/{did}/approve").status_code == 200
    assert frame(s, did).status_code == 404  # approved, not published before start
    sid = t.post(f"/api/v1/lectures/{lid}/sessions/start", json={}).json()["id"]
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").json()["diagrams"] == []
    assert frame(s, did).status_code == 404  # not the live active slide
    t.post(f"/api/v1/sessions/{sid}/slides/change", json={"index": 1})
    snapshot = s.get(f"/api/v1/sessions/{sid}/snapshot").json()
    assert [d["id"] for d in snapshot["diagrams"]] == [did]
    assert "javascript" not in json.dumps(snapshot)
    assert frame(s, did).status_code == 200
    for action in ["approve", "reject"]:
        assert t.post(f"/api/v1/diagrams/{did}/{action}").status_code == 409
    assert t.post(path + "/analyse").status_code == 409
    assert t.post(path + "/generate", json={"request_id": str(uuid4()), "slide_index": 0}).status_code == 409
    t.post(f"/api/v1/sessions/{sid}/end")
    assert frame(s, did).status_code == 200
    assert s.get(path + "/approved").json()[0]["id"] == did
    with factory() as db:
        db.get(Membership, (cid, student)).status = "removed"
        db.commit()
    assert frame(s, did).status_code == 404
    assert s.get(path + "/approved").status_code == 404


def test_revisions_rejection_unique_approval_and_duplicate_requests(prep, monkeypatch):
    t, s, _, factory, _, lid, *_ = prep
    did = generated(prep, monkeypatch)
    t.post(f"/api/v1/diagrams/{did}/approve")
    second = generated(prep, monkeypatch)
    with factory() as db:
        assert db.get(DiagramRevision, did).status == "approved"
        r = db.get(DiagramRevision, second)
        request_id = r.request_id
    assert (
        t.post(f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": request_id, "slide_index": 0}).json()[
            "id"
        ]
        == second
    )
    assert (
        t.post(
            f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": request_id, "slide_index": 1}
        ).status_code
        == 409
    )
    assert t.post(f"/api/v1/diagrams/{second}/approve").status_code == 200
    with factory() as db:
        assert db.get(DiagramRevision, did).status == "superseded"
        assert len(list(db.scalars(select(DiagramRevision).where(DiagramRevision.status == "approved")))) == 1
        db.get(DiagramRevision, did).status = "approved"
        with pytest.raises(IntegrityError):
            db.commit()
    assert frame(t, did).status_code == 404
    t.post(f"/api/v1/diagrams/{second}/reject")
    assert frame(t, second).status_code == 404
    assert frame(s, second).status_code == 404
    a = t.post(f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": 0}).json()
    b = t.post(f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": 0}).json()
    assert a["id"] == b["id"]
    assert t.post(f"/api/v1/diagrams/{a['id']}/approve").status_code == 409
    assert (
        t.post(
            f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": 8}
        ).status_code
        == 422
    )


def test_pixel_changes_invalidate_but_ocr_does_not(prep, monkeypatch):
    t, s, _, factory, _, lid, rid, _, root = prep
    did = generated(prep, monkeypatch)
    with factory() as db:
        resource = db.get(Resource, rid)
        resource.pages = [{**p, "text": "Late OCR corrected text"} for p in resource.pages]
        db.commit()
    assert t.post(f"/api/v1/diagrams/{did}/approve").status_code == 200
    sid = t.post(f"/api/v1/lectures/{lid}/sessions/start", json={}).json()["id"]
    assert frame(s, did).status_code == 200
    Image.new("RGB", (160, 100), "red").save(root / "0.png")
    assert frame(s, did).status_code == 409
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").json()["diagrams"] == []


def test_start_during_generation_discards_result(prep, monkeypatch):
    t, _, _, factory, _, lid, *_ = prep

    async def provider(*args, **kwargs):
        assert t.post(f"/api/v1/lectures/{lid}/sessions/start", json={}).status_code == 200
        return validate_artifact(RESPONSIVE)

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", provider)
    data = t.post(
        f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": 0}
    ).json()
    with factory() as db:
        r = db.get(DiagramRevision, data["id"])
        job = db.get(Job, r.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        ai.generation_job(db, job)
        db.refresh(r)
        assert r.status == "stale" and r.artifact is None and r.published_at is None


def test_zero_suggestions_checkpoints_and_retries(prep, monkeypatch):
    t, _, _, factory, _, lid, *_ = prep
    batches = []

    async def provider(self, prompt, images, schema, **kwargs):
        batches.append(len(images))
        assert "No target/minimum count" in prompt
        return ai.Opportunities(suggestions=[])

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", provider)
    aid = t.post(f"/api/v1/lectures/{lid}/diagrams/analyse").json()["id"]
    assert t.post(f"/api/v1/lectures/{lid}/diagrams/analyse").json()["id"] == aid
    with factory() as db:
        a = db.get(DiagramAnalysis, aid)
        job = db.get(Job, a.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        assert ai.analysis_job(db, job) is False
        assert a.completed_pages == 6
        assert ai.analysis_job(db, job) is True
        job.status = "ready"
        db.commit()
    result = t.get(f"/api/v1/lectures/{lid}/diagrams/preparation").json()["analysis"]
    assert batches == [6, 2] and result["suggestions"] == [] and result["completed_pages"] == 8


def test_invalid_analysis_indices_and_stale_attempt(prep, monkeypatch):
    t, _, _, factory, _, lid, *_ = prep

    async def bad(*args, **kwargs):
        return ai.Opportunities(
            suggestions=[
                ai.Suggestion(
                    slide_index=7,
                    title="Invalid batch index",
                    learning_benefit="test",
                    interaction="test",
                    confidence="high",
                    rationale="test",
                )
            ]
        )

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", bad)
    aid = t.post(f"/api/v1/lectures/{lid}/diagrams/analyse").json()["id"]
    with factory() as db:
        a = db.get(DiagramAnalysis, aid)
        job = db.get(Job, a.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        with pytest.raises(ValueError, match="indices"):
            ai.analysis_job(db, job)
        db.rollback()
        assert db.get(DiagramAnalysis, aid).completed_pages == 0

    async def stale(self, *args, **kwargs):
        with factory() as other:
            job = other.scalar(select(Job).where(Job.type == "generate_diagram"))
            job.attempts += 1
            other.commit()
        return validate_artifact(RESPONSIVE)

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", stale)
    data = t.post(
        f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": 0}
    ).json()
    with factory() as db:
        r = db.get(DiagramRevision, data["id"])
        job = db.get(Job, r.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        ai.generation_job(db, job)
        db.refresh(r)
        assert r.artifact is None and r.status == "pending"


def test_cross_course_guess_and_anonymous_request(prep, monkeypatch):
    t, s, o, factory, cid, lid, *_ = prep
    did = generated(prep, monkeypatch)
    other = o.post("/api/v1/courses", json={"name": "No permissions"})
    assert other.status_code == 403
    # A lecturer of a different course is equally denied.
    signup(o, "lecturer", "other-lecturer@example.com")
    assert o.post("/api/v1/courses", json={"name": "Other course"}).status_code == 201
    assert frame(o, did).status_code == 404
    o.post("/api/v1/auth/logout")
    assert frame(o, did).status_code == 401
    assert o.get(f"/api/v1/lectures/{lid}/diagrams/preparation").status_code == 401


@pytest.mark.parametrize(
    "field,value",
    [
        ("html", "<script>alert(1)</script><button>Go</button>"),
        ("html", '<a href="https://example.com">Go</a>'),
        ("html", '<button onclick="evil()">Go</button>'),
        ("html", '<meta http-equiv="refresh" content="0;url=https://example.com">'),
        ("javascript", "window.parent.document.body.remove()"),
        ("javascript", "window.top.document.body.remove()"),
        ("javascript", "globalThis['top'].document.body.remove()"),
        ("javascript", "self?.top.document.body.remove()"),
        ("javascript", "top.document.body.remove()"),
        ("javascript", 'top.location="https://example.com"'),
        ("javascript", 'top["location"]="https://example.com"'),
        ("javascript", 'fetch("https://example.com")'),
        ("javascript", 'import("https://example.com")'),
        ("javascript", "</script><script>alert(1)</script>"),
        ("css", "body{background:url(https://example.com)}"),
        ("html", "<svg><text>Static only</text></svg>"),
    ],
)
def test_unsupported_artifacts_rejected(field, value):
    with pytest.raises(ValueError):
        validate_artifact({**SAFE, field: value})


def test_multimodal_adapter_request_and_failure(monkeypatch):
    import app.ai.providers.openai as provider

    seen = []

    async def request(path, payload, **kwargs):
        seen.append(payload)
        return {"status": "completed", "output": [{"content": [{"type": "output_text", "text": json.dumps(SAFE)}]}]}

    monkeypatch.setattr(provider, "request", request)
    artifact = asyncio.run(
        OpenAIVision().structured_images("Authored slide", ["data:image/jpeg;base64,eA=="], routes.Artifact)
    )
    assert artifact.title == SAFE["title"]
    assert seen[0]["input"][1]["content"][1]["type"] == "input_image"
    assert seen[0]["text"]["format"]["strict"] is True and seen[0]["store"] is False
    assert seen[0]["model"] == settings().openai_diagram_model

    async def incomplete(*args, **kwargs):
        return {"status": "incomplete", "output": []}

    monkeypatch.setattr(provider, "request", incomplete)
    with pytest.raises(RuntimeError, match="complete"):
        asyncio.run(OpenAIVision().structured_images("test", ["data:image/jpeg;base64,eA=="], routes.Artifact))

    async def refusal(*args, **kwargs):
        return {"status": "completed", "output": [{"content": [{"type": "refusal"}]}]}

    monkeypatch.setattr(provider, "request", refusal)
    with pytest.raises(RuntimeError, match="declined"):
        asyncio.run(OpenAIVision().structured_images("test", ["data:image/jpeg;base64,eA=="], routes.Artifact))


def test_normal_function_declaration_is_supported():
    validate_artifact(
        {**SAFE, "javascript": "function update() { document.querySelector('#size').textContent='128'; } update();"}
    )


@pytest.mark.parametrize(
    "javascript",
    [
        "const top = 40; document.querySelector('#size').textContent=String(top);",
        "const bounds = document.querySelector('#size').getBoundingClientRect(); const y=bounds.top;",
        "const bounds = document.querySelector('#size').getBoundingClientRect(); const y=bounds['top'];",
        "// Position the label at the top.\ndocument.querySelector('#size').textContent='128';",
    ],
)
def test_normal_geometry_and_local_top_are_supported(javascript):
    validate_artifact({**SAFE, "javascript": javascript})


def test_worker_failure_is_private_and_retryable(prep, monkeypatch, caplog):
    from app import worker

    t, s, _, factory, _, lid, *_ = prep
    response = t.post(f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": 0})
    did = response.json()["id"]

    async def failure(*args, **kwargs):
        raise ValueError("sensitive-code-or-slide-text-must-never-leak")

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", failure)
    monkeypatch.setattr(worker, "SessionLocal", factory)
    assert worker.run_once() is True
    with factory() as db:
        r = db.get(DiagramRevision, did)
        job = db.get(Job, r.job_id)
        assert job.status == "queued" and job.attempts == 1
        assert "sensitive-code" not in job.error_message
        assert r.artifact is None
    assert "sensitive-code" not in t.get(f"/api/v1/lectures/{lid}/diagrams/preparation").text
    assert frame(s, did).status_code == 404
    assert "sensitive-code" not in caplog.text


def test_worker_reports_safe_validation_reason_without_generated_source(prep, monkeypatch, caplog):
    from app import worker

    t, _, _, factory, _, lid, *_ = prep
    response = t.post(f"/api/v1/lectures/{lid}/diagrams/generate", json={"request_id": str(uuid4()), "slide_index": 0})
    did = response.json()["id"]

    async def unsupported(*args, **kwargs):
        return routes.Artifact(**{**RESPONSIVE, "javascript": 'fetch("sensitive-generated-source")'})

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", unsupported)
    monkeypatch.setattr(worker, "SessionLocal", factory)
    assert worker.run_once() is True
    with factory() as db:
        revision = db.get(DiagramRevision, did)
        job = db.get(Job, revision.job_id)
        assert job.status == "queued" and job.attempts == 1
        assert "Unsupported JavaScript capability (fetch)" in job.error_message
        assert revision.artifact is None
    status = t.get(f"/api/v1/lectures/{lid}/diagrams/preparation").text
    assert "Unsupported JavaScript capability (fetch)" in status
    assert "sensitive-generated-source" not in status + caplog.text
    assert "Unsupported JavaScript capability (fetch)" in caplog.text


def test_analysis_finishing_after_start_does_not_save_proposals(prep, monkeypatch):
    t, _, _, factory, _, lid, *_ = prep
    aid = t.post(f"/api/v1/lectures/{lid}/diagrams/analyse").json()["id"]

    async def provider(*args, **kwargs):
        t.post(f"/api/v1/lectures/{lid}/sessions/start", json={})
        return ai.Opportunities(
            suggestions=[
                ai.Suggestion(
                    slide_index=0,
                    title="Intervals",
                    learning_benefit="Halving",
                    interaction="Stepper",
                    confidence="high",
                    rationale="Shows halving",
                )
            ]
        )

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", provider)
    with factory() as db:
        a = db.get(DiagramAnalysis, aid)
        job = db.get(Job, a.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        ai.analysis_job(db, job)
        db.refresh(a)
        assert a.completed_pages == 0 and a.suggestions == []


def test_refinement_receives_previous_completed_explanation(prep, monkeypatch):
    t, _, _, factory, _, lid, *_ = prep
    previous = generated(prep, monkeypatch)
    seen = []

    async def provider(self, prompt, *args, **kwargs):
        seen.append(prompt)
        return validate_artifact(RESPONSIVE)

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", provider)
    did = t.post(
        f"/api/v1/lectures/{lid}/diagrams/generate",
        json={
            "request_id": str(uuid4()),
            "slide_index": 0,
            "feedback": "Add a comparison between two parameter values",
        },
    ).json()["id"]
    with factory() as db:
        r = db.get(DiagramRevision, did)
        job = db.get(Job, r.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        ai.generation_job(db, job)
    assert (
        previous in seen[0]
        and SAFE["javascript"] in json.loads(seen[0].split("Data: ")[1])["previous_diagram"]["javascript"]
    )


def test_initial_generation_passes_optional_lecturer_guidance_to_model(prep, monkeypatch):
    t, _, _, factory, _, lid, *_ = prep
    guidance = "Compare two search intervals side by side, with a shared step control."
    seen = []

    async def provider(self, prompt, images, *args, **kwargs):
        seen.append((prompt, images))
        return validate_artifact(RESPONSIVE)

    monkeypatch.setattr(ai.OpenAIVision, "structured_images", provider)
    request_id = str(uuid4())
    response = t.post(
        f"/api/v1/lectures/{lid}/diagrams/generate",
        json={"request_id": request_id, "slide_index": 0, "feedback": guidance},
    )
    assert response.status_code == 202
    did = response.json()["id"]
    with factory() as db:
        revision = db.get(DiagramRevision, did)
        assert revision.feedback == guidance
        job = db.get(Job, revision.job_id)
        job.status = "processing"
        job.attempts = 1
        db.commit()
        ai.generation_job(db, job)
        db.refresh(revision)
        assert revision.status == "preview"
    context = json.loads(seen[0][0].split("Data: ")[1])
    assert context["lecturer_guidance"] == guidance
    assert context["previous_diagram"] is None
    assert len(seen[0][1]) == 1 and seen[0][1][0].startswith("data:image/jpeg;base64,")
    # Notes are part of the idempotency input; changing them requires a new request.
    assert (
        t.post(
            f"/api/v1/lectures/{lid}/diagrams/generate",
            json={"request_id": request_id, "slide_index": 0, "feedback": guidance + " Add a reset."},
        ).status_code
        == 409
    )


def test_migration16_roundtrip_preserves_lecture(prep):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect

    _, _, _, factory, _, lid, *_ = prep
    spec = importlib.util.spec_from_file_location("migration16", Path("alembic/versions/0016_interactive_diagrams.py"))
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with factory() as db:
        connection = db.connection()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.downgrade()
        assert "diagram_revisions" not in inspect(connection).get_table_names()
        migration.upgrade()
        assert "diagram_revisions" in inspect(connection).get_table_names()
        assert db.get(Lecture, lid) is not None


def test_responsive_contract_rejects_missing_or_misplaced_regions():
    validate_artifact(RESPONSIVE, require_responsive=True)
    validate_artifact(SAFE)  # Earlier approved artifacts still render with legacy layout.
    with pytest.raises(ValueError, match="responsive-v2"):
        validate_artifact(SAFE, require_responsive=True)
    with pytest.raises(ValueError, match="responsive-v2"):
        validate_artifact(
            {**RESPONSIVE, "html": RESPONSIVE["html"].replace('data-region="controls"', 'data-region="visual"')},
            require_responsive=True,
        )
    with pytest.raises(ValueError, match="responsive-v2"):
        validate_artifact(
            {**RESPONSIVE, "html": RESPONSIVE["html"].replace("</section></div>", "</div>")}, require_responsive=True
        )


def test_responsive_wrapper_preserves_legacy_content_and_security():
    from app.diagram_render import document, RENDER_CSP

    current = document(validate_artifact(RESPONSIVE), str(uuid4()), str(uuid4()))
    legacy = document(validate_artifact(SAFE), str(uuid4()), str(uuid4()))
    assert '<body class="ll-responsive">' in current
    assert "<body>" in legacy and SAFE["javascript"] in legacy
    assert "grid-template-columns:minmax(0,1fr)" in current
    assert "sandbox allow-scripts" in RENDER_CSP and "connect-src 'none'" in RENDER_CSP
