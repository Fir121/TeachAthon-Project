import json
import subprocess
from pathlib import Path
import pymupdf
from .materials import private_path
from .models import Resource


def command(args, timeout=180):
    try:
        subprocess.run(args, check=True, timeout=timeout, capture_output=True)
    except subprocess.CalledProcessError:
        raise RuntimeError(f"{Path(args[0]).name} could not process this file. Check the source and retry.")


def ingest(db, job):
    resource = db.get(Resource, job.target_id)
    if not resource:
        return
    resource.process_status = "processing"
    resource.error_message = None
    db.commit()
    try:
        source = private_path(resource.storage_key)
        pages = []
        if resource.kind in {"pdf", "pptx", "docx"}:
            pdf = source
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
                pdf = source.with_suffix(".pdf")
            with pymupdf.open(pdf) as doc:
                if len(doc) > 500:
                    raise RuntimeError("Document exceeds the 500-page limit.")
                for i, page in enumerate(doc):
                    image = source.parent / f"page-{i}.png"
                    page.get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(image)
                    pages.append({"image": str(image.relative_to(private_path(""))), "text": page.get_text()})
        elif resource.kind in {"txt", "json"}:
            text = source.read_text(encoding="utf-8")
            if resource.kind == "json":
                text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
            pages = [{"text": text[i : i + 6000]} for i in range(0, len(text), 6000)]
        else:
            import asyncio
            from .audio import transcribe_windows

            asyncio.run(transcribe_windows(db, resource))
            pages = resource.pages
        resource.pages = pages
        resource.process_status = "ready"
        from .ai.retrieval import enqueue_index

        enqueue_index(db, resource.course_id, resource.id)
        db.commit()
    except Exception as exc:
        db.rollback()
        resource = db.get(Resource, job.target_id)
        resource.process_status = "failed"
        resource.error_message = str(exc)[:300]
        db.commit()
        raise
