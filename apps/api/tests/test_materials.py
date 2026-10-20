import io
import pymupdf
from conftest import signup
from app.models import Job, Resource
from app.ingest import ingest
from sqlalchemy import select


def test_enrolment_and_multilecturer(clients):
    t, s, o, _ = clients
    signup(t)
    s_user = signup(s, "student", "s@example.com")
    signup(o, "lecturer", "other@example.com")
    cid = t.post("/api/v1/courses", json={"name": "Physics"}).json()["id"]
    assert s.post(f"/api/v1/courses/{cid}/join-requests").json()["status"] == "pending"
    assert s.get(f"/api/v1/courses/{cid}").status_code == 404
    assert t.post(f"/api/v1/courses/{cid}/join-requests/{s_user['id']}/approve").status_code == 200
    assert s.get(f"/api/v1/courses/{cid}").status_code == 200
    invite = t.post(f"/api/v1/courses/{cid}/invitations", json={"role": "lecturer"}).json()
    assert o.post("/api/v1/invitations/accept", json={"token": invite["token"]}).status_code == 200
    assert o.post(f"/api/v1/courses/{cid}/folders", json={"name": "Shared"}).status_code == 201
    assert o.post("/api/v1/invitations/accept", json={"token": invite["token"]}).status_code == 404


def test_upload_conversion_folder_cycles_and_isolation(clients, tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings(), "media_root", str(tmp_path))
    t, s, o, factory = clients
    signup(t)
    signup(s, "student", "s@example.com")
    cid = t.post("/api/v1/courses", json={"name": "Algorithms"}).json()["id"]
    folder = t.post(f"/api/v1/courses/{cid}/folders", json={"name": "Week 1"}).json()
    assert (
        t.patch(f"/api/v1/folders/{folder['id']}", json={"name": "Cycle", "parent_id": folder["id"]}).status_code == 409
    )
    assert (
        t.post(
            f"/api/v1/courses/{cid}/resources", files={"file": ("bad.pdf", b"not a pdf", "application/pdf")}
        ).status_code
        == 415
    )
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((60, 60), "Algorithmic complexity and binary search")
        content = doc.tobytes()
    r = t.post(f"/api/v1/courses/{cid}/resources", files={"file": ("deck.pdf", io.BytesIO(content), "application/pdf")})
    assert r.status_code == 202, r.text
    rid = r.json()["id"]
    assert s.get(f"/api/v1/resources/{rid}/download").status_code == 404
    assert (
        t.post(
            f"/api/v1/courses/{cid}/lectures", json={"title": "Before processing", "slide_resource_id": rid}
        ).status_code
        == 409
    )
    with factory() as db:
        ingest(db, db.scalar(select(Job).where(Job.target_id == rid)))
        assert db.get(Resource, rid).process_status == "ready"
    assert t.get(f"/api/v1/resources/{rid}/pages/0").headers["content-type"] == "image/png"
    assert (
        t.post(f"/api/v1/courses/{cid}/lectures", json={"title": "Complexity", "slide_resource_id": rid}).status_code
        == 201
    )


def test_corrupt_file_failure_can_be_retried(clients, tmp_path, monkeypatch):
    import pytest
    from app.config import settings
    from app import worker

    monkeypatch.setattr(settings(), "media_root", str(tmp_path))
    t, s, o, factory = clients
    signup(t)
    cid = t.post("/api/v1/courses", json={"name": "Retry test"}).json()["id"]
    r = t.post(
        f"/api/v1/courses/{cid}/resources",
        files={"file": ("broken.pdf", b"%PDF-1.7\ncorrupted bytes", "application/pdf")},
    )
    rid = r.json()["id"]
    monkeypatch.setattr(worker, "SessionLocal", factory)
    assert worker.run_once()
    status = t.get(f"/api/v1/resources/{rid}").json()
    assert status["process_status"] == "failed" and status["error_message"]
    r = t.post(f"/api/v1/resources/{rid}/reprocess")
    assert r.status_code == 202, r.text
    assert r.json()["process_status"] == "queued"


def test_actual_powerpoint_conversion_in_linux(clients, tmp_path, monkeypatch):
    import shutil
    import subprocess
    from pathlib import Path
    import pytest
    from app.config import settings

    if not shutil.which("libreoffice"):
        pytest.skip("LibreOffice conversion is checked in the Linux image")
    monkeypatch.setattr(settings(), "media_root", str(tmp_path / "media"))
    fixture = Path(__file__).parent / "fixtures/deck.fodp"
    subprocess.run(
        [
            "libreoffice",
            f"-env:UserInstallation=file://{tmp_path}/office-test",
            "--headless",
            "--convert-to",
            "pptx",
            "--outdir",
            str(tmp_path),
            str(fixture),
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    pptx = tmp_path / "deck.pptx"
    assert pptx.exists()
    t, s, o, factory = clients
    signup(t)
    cid = t.post("/api/v1/courses", json={"name": "PowerPoint"}).json()["id"]
    rid = t.post(
        f"/api/v1/courses/{cid}/resources",
        files={
            "file": (
                "deck.pptx",
                pptx.read_bytes(),
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
        },
    ).json()["id"]
    with factory() as db:
        ingest(db, db.scalar(select(Job).where(Job.target_id == rid)))
        resource = db.get(Resource, rid)
        assert resource.process_status == "ready" and len(resource.pages) == 1
        assert "Binary search" in resource.pages[0]["text"]


def test_index_status_uses_latest_job_not_backoff_schedule(clients):
    from datetime import timedelta
    from app.models import now
    from app.materials import resource_json

    t, s, o, factory = clients
    signup(t)
    cid = t.post("/api/v1/courses", json={"name": "Index ordering"}).json()["id"]
    with factory() as db:
        r = Resource(
            course_id=cid,
            original_filename="notes.txt",
            storage_key="notes.txt",
            content_type="text/plain",
            size_bytes=5,
            sha256="hash",
            kind="txt",
            process_status="ready",
            pages=[],
        )
        db.add(r)
        db.flush()
        db.add(
            Job(
                type="index_resource",
                course_id=cid,
                target_id=r.id,
                status="failed",
                created_at=now() - timedelta(minutes=5),
                next_run_at=now() + timedelta(minutes=5),
            )
        )
        db.add(
            Job(
                type="index_resource",
                course_id=cid,
                target_id=r.id,
                status="ready",
                created_at=now(),
                next_run_at=now(),
            )
        )
        db.commit()
        assert resource_json(r, db)["index_status"] == "ready"
