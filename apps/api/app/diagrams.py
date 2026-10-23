"""Course-authorized preparation and publication of isolated interactive artifacts."""

from uuid import UUID
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from .security import DB, Actor, member
from .materials import require
from .models import Lecture, Resource, LiveSession, DiagramAnalysis, DiagramRevision, Job, now, uid
from .config import settings
from .ai.diagrams import fingerprints, deck_digest, slide_image, source_matches
from .diagram_render import Artifact, document, RENDER_CSP

router = APIRouter(prefix="/api/v1")


def lecture_access(db, lid, user, *, edit=False, teacher=False):
    lecture = require(db, Lecture, lid)
    member(db, lecture.course_id, user, lecturer=teacher or edit)
    if edit:
        lecture = db.scalar(
            select(Lecture).where(Lecture.id == lid).with_for_update().execution_options(populate_existing=True)
        )
        if db.scalar(select(LiveSession.id).where(LiveSession.lecture_id == lid)):
            raise HTTPException(409, "Interactive diagrams are fixed once this lecture has started.")
    resource = require(db, Resource, lecture.slide_resource_id)
    if resource.course_id != lecture.course_id:
        raise HTTPException(404, "Slide deck not available.")
    return lecture, resource


def image_fingerprint(resource, index):
    if index < 0 or index >= len(resource.pages):
        raise HTTPException(422, "Slide index is out of range.")
    try:
        return slide_image(resource, index)
    except (ValueError, OSError):
        raise HTTPException(409, "Slide image unavailable. Retry deck processing before preparing diagrams.")


def job_json(db, job_id):
    job = db.get(Job, job_id)
    return {"status": job.status, "attempts": job.attempts, "error": job.error_message}


def metadata(revision):
    data = revision.artifact or {}
    return {
        "id": revision.id,
        "slide_index": revision.slide_index,
        **{key: data.get(key, "") for key in ("title", "summary", "instructions", "accessibility_description")},
        "render_url": f"/api/v1/diagrams/{revision.id}/render",
    }


def revision_json(db, revision, resource):
    matches = source_matches(db, revision, resource)
    return {
        **metadata(revision),
        "status": revision.status if matches else "stale",
        "source_matches": matches,
        "feedback": revision.feedback,
        "created_at": revision.created_at,
        "approved_at": revision.approved_at,
        "published_at": revision.published_at,
        "job": job_json(db, revision.job_id),
    }


def approved_for(db, lecture, *, index=None):
    """Only source-matching, explicitly frozen revisions leave the lecturer domain."""
    query = select(DiagramRevision).where(
        DiagramRevision.lecture_id == lecture.id,
        DiagramRevision.course_id == lecture.course_id,
        DiagramRevision.status == "approved",
        DiagramRevision.published_at.is_not(None),
    )
    if index is not None:
        query = query.where(DiagramRevision.slide_index == index)
    resource = db.get(Resource, lecture.slide_resource_id)
    return [
        metadata(r) for r in db.scalars(query.order_by(DiagramRevision.slide_index)) if source_matches(db, r, resource)
    ]


def freeze_approved(db, lecture):
    # Called under the same lecture lock as every editor and worker result.
    for revision in db.scalars(select(DiagramRevision).where(DiagramRevision.lecture_id == lecture.id)):
        if revision.status == "approved":
            if source_matches(db, revision):
                revision.published_at = now()
            else:
                revision.status = "stale"
        elif revision.status == "pending":
            revision.status = "stale"


@router.get("/lectures/{lid}/diagrams/preparation")
def preparation(lid: str, db: DB, user: Actor):
    lecture, resource = lecture_access(db, lid, user, teacher=True)
    analyses = list(
        db.scalars(
            select(DiagramAnalysis).where(DiagramAnalysis.lecture_id == lid).order_by(DiagramAnalysis.created_at.desc())
        )
    )
    analysis = analyses[0] if analyses else None
    source_current = False
    if analysis:
        try:
            source_current = deck_digest(fingerprints(resource)) == analysis.source_fingerprint
        except (ValueError, OSError):
            pass
    return {
        "locked": bool(db.scalar(select(LiveSession.id).where(LiveSession.lecture_id == lid))),
        "analysis": (
            {
                "id": analysis.id,
                "job": job_json(db, analysis.job_id),
                "completed_pages": analysis.completed_pages,
                "total_pages": len(analysis.fingerprints),
                "suggestions": analysis.suggestions if source_current else [],
                "source_matches": source_current,
                "input_note": analysis.input_note,
            }
            if analysis
            else None
        ),
        "revisions": [
            revision_json(db, r, resource)
            for r in db.scalars(
                select(DiagramRevision)
                .where(DiagramRevision.lecture_id == lecture.id)
                .order_by(DiagramRevision.created_at.desc())
            )
        ],
    }


@router.post("/lectures/{lid}/diagrams/analyse", status_code=202)
def analyse(lid: str, db: DB, user: Actor):
    lecture, resource = lecture_access(db, lid, user, edit=True)
    if not resource.pages:
        raise HTTPException(409, "Wait for the slide images to be ready.")
    try:
        values = fingerprints(resource)
    except (ValueError, OSError):
        raise HTTPException(409, "The complete deck images are unavailable. Retry deck processing.")
    digest = deck_digest(values)
    analysis = db.scalar(
        select(DiagramAnalysis).where(DiagramAnalysis.lecture_id == lid, DiagramAnalysis.source_fingerprint == digest)
    )
    if analysis:
        job = db.get(Job, analysis.job_id)
        if job.status == "failed":
            job.status, job.attempts, job.next_run_at, job.error_message = "queued", 0, now(), None
    else:
        job = Job(id=uid(), type="analyse_diagrams", course_id=lecture.course_id, target_id=uid())
        db.add(job)
        db.flush()
        analysis = DiagramAnalysis(
            id=job.target_id,
            lecture_id=lid,
            course_id=lecture.course_id,
            source_fingerprint=digest,
            fingerprints=values,
            job_id=job.id,
            input_note=(
                "Rendered images with available extracted text. OCR may still be incomplete; images are the primary evidence."
                if resource.extraction_json.get("status") != "ready"
                else "Rendered images and extracted slide text."
            ),
        )
        db.add(analysis)
    db.commit()
    return {"id": analysis.id, "job": job_json(db, analysis.job_id)}


class GenerateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    slide_index: int = Field(ge=0)
    feedback: str = Field(default="", max_length=1500)


@router.post("/lectures/{lid}/diagrams/generate", status_code=202)
def generate(lid: str, data: GenerateInput, db: DB, user: Actor):
    lecture, resource = lecture_access(db, lid, user, edit=True)
    fingerprint = image_fingerprint(resource, data.slide_index)
    revision = db.scalar(
        select(DiagramRevision).where(
            DiagramRevision.lecture_id == lid, DiagramRevision.request_id == str(data.request_id)
        )
    )
    if revision:
        if (
            revision.slide_index != data.slide_index
            or revision.feedback != data.feedback
            or revision.source_fingerprint != fingerprint
        ):
            raise HTTPException(
                409, "This generation request was already used for different input. Start a new request."
            )
    else:
        # Serialize by lecture. Double clicks / separate tabs share active identical work.
        revision = db.scalar(
            select(DiagramRevision)
            .join(Job, Job.id == DiagramRevision.job_id)
            .where(
                DiagramRevision.lecture_id == lid,
                DiagramRevision.slide_index == data.slide_index,
                DiagramRevision.source_fingerprint == fingerprint,
                DiagramRevision.feedback == data.feedback,
                DiagramRevision.status == "pending",
                Job.status.in_(["queued", "processing"]),
            )
        )
        if not revision:
            job = Job(id=uid(), type="generate_diagram", course_id=lecture.course_id, target_id=uid())
            db.add(job)
            db.flush()
            revision = DiagramRevision(
                id=job.target_id,
                lecture_id=lid,
                course_id=lecture.course_id,
                slide_index=data.slide_index,
                request_id=str(data.request_id),
                source_fingerprint=fingerprint,
                feedback=data.feedback,
                model=settings().openai_diagram_model,
                job_id=job.id,
            )
            db.add(revision)
    db.commit()
    return revision_json(db, revision, resource)


@router.post("/diagrams/{did}/{action}")
def decide(did: str, action: str, db: DB, user: Actor):
    revision = require(db, DiagramRevision, did)
    lecture, resource = lecture_access(db, revision.lecture_id, user, edit=True)
    db.refresh(revision)
    if revision.course_id != lecture.course_id:
        raise HTTPException(404, "Diagram not found.")
    if action == "approve":
        if revision.status not in {"preview", "approved"} or not revision.artifact:
            raise HTTPException(409, "A completed preview is required before approval.")
        if not source_matches(db, revision, resource):
            raise HTTPException(409, "Slide pixels changed. Generate and review a new diagram.")
        for previous in db.scalars(
            select(DiagramRevision).where(
                DiagramRevision.lecture_id == lecture.id,
                DiagramRevision.slide_index == revision.slide_index,
                DiagramRevision.status == "approved",
                DiagramRevision.id != did,
            )
        ):
            previous.status = "superseded"
        db.flush()
        revision.status, revision.approved_by, revision.approved_at = "approved", user.id, now()
    elif action == "reject":
        revision.status = "rejected"
    else:
        raise HTTPException(404, "Unknown diagram action.")
    db.commit()
    return revision_json(db, revision, resource)


@router.get("/diagrams/{did}/preview")
def preview(did: str, db: DB, user: Actor):
    revision = require(db, DiagramRevision, did)
    _, resource = lecture_access(db, revision.lecture_id, user, teacher=True)
    if revision.status not in {"preview", "approved"} or not source_matches(db, revision, resource):
        raise HTTPException(409, "This preview is unavailable. Generate a new revision before lecture start.")
    return metadata(revision)


@router.get("/lectures/{lid}/diagrams/approved")
def approved(lid: str, db: DB, user: Actor):
    lecture, _ = lecture_access(db, lid, user)
    session = db.scalar(select(LiveSession).where(LiveSession.lecture_id == lid))
    return approved_for(db, lecture, index=session.active_slide_index if session and session.state == "live" else None)


@router.get("/diagrams/{did}/render", response_class=HTMLResponse)
def render(did: str, request: Request, db: DB, user: Actor, viewer: UUID):
    revision = require(db, DiagramRevision, did)
    lecture, resource = lecture_access(db, revision.lecture_id, user)
    membership = member(db, lecture.course_id, user)
    session = db.scalar(select(LiveSession).where(LiveSession.lecture_id == lecture.id))
    visible = revision.status == "approved" and revision.published_at is not None
    if membership.role != "lecturer" and (
        not visible or (session and session.state == "live" and session.active_slide_index != revision.slide_index)
    ):
        raise HTTPException(404, "Diagram not available on this slide.")
    if (
        revision.course_id != lecture.course_id
        or revision.status not in {"preview", "approved"}
        or not revision.artifact
    ):
        raise HTTPException(404, "Diagram not available.")
    if not source_matches(db, revision, resource):
        raise HTTPException(409, "This diagram needs review because the slide image changed.")
    # A direct top-level navigation must not become an application-origin escape hatch.
    if request.headers.get("sec-fetch-dest") != "iframe" or request.headers.get("sec-fetch-site") != "same-origin":
        raise HTTPException(403, "Open this diagram from the lecture viewer.")
    return HTMLResponse(
        document(Artifact.model_validate(revision.artifact), did, str(viewer)),
        headers={
            "Content-Security-Policy": RENDER_CSP,
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )
