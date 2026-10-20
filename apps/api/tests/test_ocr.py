"""Real authored fixtures; this suite runs in the provisioned Linux worker, offline."""

import importlib.util
import io
import json
import shutil
import time
from pathlib import Path
import pytest
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from sqlalchemy import select
from conftest import signup
from app.models import Resource, Job, SourceChunk
from app.ingest import ingest, extract_document, queue_backfill
from app.ocr import EXTRACTION_VERSION

pytestmark = pytest.mark.skipif(
    not shutil.which("pdftoppm") or not importlib.util.find_spec("paddleocr"),
    reason="Real OCR runs in provisioned Linux worker",
)


def authored_pdf():
    stream = io.BytesIO()
    doc = canvas.Canvas(stream, pagesize=(612, 792))
    doc.setFont("Helvetica-Bold", 24)
    doc.drawString(50, 730, "Binary search")
    doc.setFont("Helvetica", 17)
    doc.drawString(50, 680, "Sorted data halves the search interval.")
    doc.showPage()
    image = Image.new("RGB", (1224, 1584), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34)
    draw.text((100, 120), "Scanned classroom notes", fill="black", font=font)
    draw.text((100, 220), "Binary search uses sorted data.", fill="black", font=font)
    doc.drawImage(ImageReader(image), 0, 0, width=612, height=792)
    doc.showPage()
    doc.setFont("Helvetica-Bold", 22)
    doc.drawString(50, 730, "Reading columns")
    doc.setFont("Helvetica", 14)
    for index, line in enumerate(
        ["Left column starts here.", "Sorted values permit", "binary search to halve", "the remaining interval."]
    ):
        doc.drawString(50, 650 - index * 24, line)
    for index, line in enumerate(
        ["Right column follows.", "The comparison count", "grows logarithmically", "with the input size."]
    ):
        doc.drawString(335, 650 - index * 24, line)
    doc.showPage()
    doc.showPage()  # Intentionally empty physical page.
    doc.setPageRotation(90)
    doc.setCropBox((550, 730))
    doc.setFont("Helvetica", 18)
    doc.drawString(60, 400, "Rotated classroom page")
    doc.showPage()
    doc.setPageRotation(0)
    doc.setFont("Helvetica", 18)
    doc.drawString(50, 700, "Resumed final page after checkpoint")
    doc.save()
    return stream.getvalue()


def test_cpu_ocr_checkpoint_resume_order_and_atomic_backfill(clients, tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings(), "media_root", str(tmp_path))
    t, _, _, factory = clients
    signup(t)
    cid = t.post("/api/v1/courses", json={"name": "OCR authored validation"}).json()["id"]
    rid = t.post(
        f"/api/v1/courses/{cid}/resources", files={"file": ("authored.pdf", authored_pdf(), "application/pdf")}
    ).json()["id"]
    started = time.monotonic()
    with factory() as db:
        ingest(db, db.scalar(select(Job).where(Job.target_id == rid, Job.type == "ingest_document")))
        resource = db.get(Resource, rid)
        assert resource.process_status == "ready" and len(resource.pages) == 6
        assert all(Path(tmp_path / page["image"]).is_file() for page in resource.pages)
        # Simulate an existing usable extraction. It must survive a failed replacement batch.
        resource.pages = [{**p, "text": "Original usable text"} for p in resource.pages]
        db.add(
            SourceChunk(
                course_id=cid,
                resource_id=rid,
                source_type="resource",
                title="old",
                text="Original usable text",
                page_number=1,
            )
        )
        db.commit()
        job = db.scalar(select(Job).where(Job.target_id == rid, Job.type == "extract_document"))
        assert extract_document(db, job) is False
        assert resource.extraction_json["completed_pages"] == 5
        assert resource.pages[0]["text"] == "Original usable text"
        folder = (tmp_path / resource.storage_key).parent / EXTRACTION_VERSION
        first_mtime = (folder / "1.json").stat().st_mtime_ns
        import app.ingest as module

        real = module.command

        def fail(*args, **kwargs):
            raise RuntimeError("Intentional batch fault")

        monkeypatch.setattr(module, "command", fail)
        with pytest.raises(RuntimeError, match="Intentional"):
            extract_document(db, job)
        assert db.scalar(select(SourceChunk.text).where(SourceChunk.resource_id == rid)) == "Original usable text"
        assert resource.process_status == "ready" and resource.extraction_json["status"] == "failed"
        monkeypatch.setattr(module, "command", real)
        extract_document(db, job)
        assert (folder / "1.json").stat().st_mtime_ns == first_mtime
        assert resource.extraction_json["status"] == "ready"
        assert "Binary search" in resource.pages[0]["text"]
        assert "Scanned classroom notes" in resource.pages[1]["text"]
        text = resource.pages[2]["text"]
        assert text.index("Left column") < text.index("Right column")
        assert text.index("remaining interval") < text.index("Right column")
        assert resource.pages[3]["text"].strip() == ""
        assert "Resumed final page" in resource.pages[5]["text"]
        assert json.loads((folder / "1.json").read_text())["blocks"][0]["bbox"]
        chunks = list(db.scalars(select(SourceChunk).where(SourceChunk.resource_id == rid)))
        assert {c.page_number for c in chunks} == {1, 2, 3, 5, 6}
        assert not any(c.text == "Original usable text" for c in chunks)
        queue_backfill(db)
        assert not db.scalar(
            select(Job).where(
                Job.target_id == rid, Job.type == "extract_document", Job.status == "queued", Job.id != job.id
            )
        )
    print(f"Real OCR authored six-page render + two batch processes: {time.monotonic() - started:.2f}s")
