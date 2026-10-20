import json
import re
import subprocess
import sys
from pathlib import Path
from sqlalchemy import select
from .materials import private_path
from .models import Resource, Job
from .ocr import EXTRACTION_VERSION, BATCH_SIZE


def command(args, timeout=180):
    try:
        return subprocess.run(args, check=True, timeout=timeout, capture_output=True).stdout
    except subprocess.CalledProcessError:
        raise RuntimeError(f"{Path(args[0]).name} could not process this file. Check the source and retry.") from None


def pdf_path(resource):
    source = private_path(resource.storage_key)
    return source if resource.kind == "pdf" else source.with_suffix(".pdf")


def queue_ocr(db, resource):
    from .ai.retrieval import enqueue_index

    enqueue_index(db, resource.course_id, resource.id, "extract_document")


def ingest(db, job):
    resource = db.get(Resource, job.target_id)
    if not resource:
        return
    usable = resource.process_status == "ready"
    if not usable:
        resource.process_status = "processing"
    resource.error_message = None
    db.commit()
    try:
        source = private_path(resource.storage_key)
        if resource.kind in {"pdf", "pptx", "docx"}:
            pdf = pdf_path(resource)
            if resource.kind != "pdf":
                command(
                    [
                        "libreoffice",
                        "-env:UserInstallation=file:///tmp/lectureloop-office",
                        "--headless",
                        "--convert-to",
                        "pdf",
                        "--outdir",
                        str(source.parent),
                        str(source),
                    ]
                )
            info = command(["pdfinfo", "-box", str(pdf)]).decode("utf-8", errors="replace")
            match = re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE)
            if not match or not 0 < int(match[1]) <= 500:
                raise RuntimeError("Document must contain between 1 and 500 pages.")
            pages = []
            for index in range(int(match[1])):
                image = source.parent / f"page-{index}.png"
                command(
                    [
                        "pdftoppm",
                        "-f",
                        str(index + 1),
                        "-l",
                        str(index + 1),
                        "-singlefile",
                        "-cropbox",
                        "-r",
                        "93.6",
                        "-png",
                        str(pdf),
                        str(image.with_suffix("")),
                    ]
                )
                old = resource.pages[index] if index < len(resource.pages) else {}
                pages.append(
                    {
                        **old,
                        "image": str(image.relative_to(private_path(""))),
                        "page_number": index + 1,
                        "text": old.get("text", ""),
                    }
                )
            resource.pages = pages
            resource.process_status = "ready"  # Rendering readiness; extraction has its own state.
            resource.extraction_json = {
                **resource.extraction_json,
                "status": "queued",
                "total_pages": len(pages),
                "target_version": EXTRACTION_VERSION,
            }
            queue_ocr(db, resource)
        elif resource.kind in {"txt", "json"}:
            text = source.read_text(encoding="utf-8")
            if resource.kind == "json":
                text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
            from .ai.retrieval import replace_resource_index
            from .ai.chunking import CHUNK_VERSION

            pages = [{"text": text}]  # Source sections, never artificial physical page numbers.
            replace_resource_index(db, resource, pages)
            resource.pages = pages
            resource.process_status = "ready"
            resource.extraction_json = {"status": "ready", "version": "utf8-v1", "chunk_version": CHUNK_VERSION}
            from .ai.retrieval import enqueue_index

            enqueue_index(db, resource.course_id, resource.id)
        else:
            import asyncio
            from .audio import transcribe_windows
            from .ai.retrieval import enqueue_index

            asyncio.run(transcribe_windows(db, resource))
            resource.process_status = "ready"
            resource.extraction_json = {"status": "ready", "version": "batch-stt-input-windows-v1"}
            enqueue_index(db, resource.course_id, resource.id)
        db.commit()
    except Exception as exc:
        db.rollback()
        resource = db.get(Resource, job.target_id)
        if resource:
            if not usable:
                resource.process_status = "failed"
            resource.error_message = str(exc)[:300]
            db.commit()
        raise


def extract_document(db, job):
    resource = db.get(Resource, job.target_id)
    if not resource:
        return
    state = dict(resource.extraction_json)
    folder = private_path(resource.storage_key).parent / EXTRACTION_VERSION
    folder.mkdir(parents=True, exist_ok=True)
    total = len(resource.pages)
    completed = 0
    while completed < total and (folder / f"{completed + 1}.json").exists():
        completed += 1
    state.update(
        error=None, status="processing", target_version=EXTRACTION_VERSION, completed_pages=completed, total_pages=total
    )
    resource.extraction_json = state
    db.commit()
    try:
        if completed < total:
            # At most five new pages, checkpointed individually. No OCR runtime in the API process.
            command(
                [
                    sys.executable,
                    "-m",
                    "app.ocr",
                    str(pdf_path(resource)),
                    str(folder),
                    str(completed + 1),
                    str(min(total, completed + BATCH_SIZE)),
                ],
                timeout=600,
            )
        completed = 0
        while completed < total and (folder / f"{completed + 1}.json").exists():
            completed += 1
        if completed < total:
            resource.extraction_json = {**state, "completed_pages": completed, "status": "queued"}
            db.commit()
            return False  # A continuation yields to recording assembly without consuming a retry.
        pages = []
        for index, page in enumerate(resource.pages):
            artifact = folder / f"{index + 1}.json"
            data = json.loads(artifact.read_text())
            pages.append(
                {
                    **page,
                    "text": data["text"],
                    "page_number": index + 1,
                    "extraction_artifact": str(artifact.relative_to(private_path(""))),
                    "extraction_version": EXTRACTION_VERSION,
                }
            )
        from .ai.retrieval import replace_resource_index, enqueue_index
        from .ai.chunking import CHUNK_VERSION

        # The old extraction AND old searchable chunks remain intact until this transaction succeeds.
        replace_resource_index(db, resource, pages)
        resource.pages = pages
        resource.extraction_json = {
            **state,
            "status": "ready",
            "completed_pages": total,
            "version": EXTRACTION_VERSION,
            "chunk_version": CHUNK_VERSION,
        }
        enqueue_index(db, resource.course_id, resource.id)
        db.commit()
    except Exception:
        db.rollback()
        resource = db.get(Resource, job.target_id)
        if resource:
            resource.extraction_json = {
                **resource.extraction_json,
                "status": "failed",
                "error": "Text extraction failed. Retry to resume from saved pages.",
            }
            db.commit()
        raise


def queue_backfill(db):
    """Idempotent and resumable: failed jobs require explicit retry; old usable data stays live."""
    from .ai.retrieval import enqueue_index
    from .ai.chunking import CHUNK_VERSION

    for resource in db.scalars(select(Resource).where(Resource.process_status == "ready")):
        metadata = resource.extraction_json
        if resource.kind in {"pdf", "pptx", "docx"}:
            kind = "extract_document"
            needed = metadata.get("version") != EXTRACTION_VERSION
        elif resource.kind in {"txt", "json"}:
            kind = "ingest_document"
            needed = metadata.get("chunk_version") != CHUNK_VERSION
        else:
            kind = "index_resource"
            needed = metadata.get("chunk_version") != CHUNK_VERSION
        if needed and not db.scalar(
            select(Job.id).where(
                Job.target_id == resource.id, Job.type == kind, Job.status.in_(["queued", "processing", "failed"])
            )
        ):
            enqueue_index(db, resource.course_id, resource.id, kind)
    # Rebuild live transcript and public forum chunks with the same splitter.
    from .models import SourceChunk

    for column, kind in [(SourceChunk.session_id, "index_session"), (SourceChunk.question_id, "index_question")]:
        for target, cid in db.execute(
            select(column, SourceChunk.course_id)
            .where(column.is_not(None), SourceChunk.chunk_metadata["version"].as_string().is_(None))
            .distinct()
        ):
            enqueue_index(db, cid, target, kind)
    db.commit()
