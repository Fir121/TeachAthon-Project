import codecs
import hashlib
import json
import secrets
import zipfile
import uuid
from datetime import timedelta, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, EmailStr
from sqlalchemy import select, func
from .config import settings
from .models import Course, Membership, User, Invitation, Folder, Resource, Lecture, Job, uid, now
from .security import DB, Actor, member, digest

router = APIRouter(prefix="/api/v1")


def require(db, cls, identifier):
    try:
        for value in identifier if isinstance(identifier, tuple) else (identifier,):
            uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(404, "Item not found.")
    obj = db.get(cls, identifier)
    if not obj:
        raise HTTPException(404, "This item is no longer available.")
    return obj


def private_path(key):
    root = Path(settings().media_root).resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise HTTPException(400, "Invalid media path.")
    return path


@router.post("/courses/{cid}/join-requests")
def request_join(cid: str, db: DB, user: Actor):
    course = require(db, Course, cid)
    if not course.discoverable or user.role != "student":
        raise HTTPException(403, "Use an invitation to join this course.")
    m = db.get(Membership, (cid, user.id))
    if not m:
        m = Membership(course_id=cid, user_id=user.id, role="student", status="pending")
        db.add(m)
    elif m.status != "active":
        m.status = "pending"
    db.commit()
    return {"status": m.status}


@router.get("/courses/{cid}/join-requests")
def join_requests(cid: str, db: DB, user: Actor):
    member(db, cid, user, True)
    return [
        {"id": u.id, "name": u.name, "email": u.email}
        for u in db.scalars(
            select(User).join(Membership).where(Membership.course_id == cid, Membership.status == "pending").limit(100)
        )
    ]


@router.post("/courses/{cid}/join-requests/{student_id}/{decision}")
def review_join(cid: str, student_id: str, decision: str, db: DB, user: Actor):
    member(db, cid, user, True)
    m = require(db, Membership, (cid, student_id))
    if decision not in {"approve", "reject"} or m.status != "pending":
        raise HTTPException(409, "This request has already been reviewed.")
    m.status = "active" if decision == "approve" else "removed"
    db.commit()
    return {"status": m.status}


class MemberInput(BaseModel):
    email: EmailStr
    role: str = Field(default="student", pattern="^(student|lecturer)$")


@router.post("/courses/{cid}/members")
def add_member(cid: str, data: MemberInput, db: DB, user: Actor):
    member(db, cid, user, True)
    db.scalar(select(Course).where(Course.id == cid).with_for_update())
    target = db.scalar(select(User).where(User.email == str(data.email).lower()))
    if not target:
        raise HTTPException(404, "Ask this person to create an account, or create an invitation link.")
    if data.role == "lecturer" and target.role != "lecturer":
        raise HTTPException(409, "Only a lecturer account can be added as a lecturer.")
    m = db.get(Membership, (cid, target.id))
    if m:
        if (
            m.role == "lecturer"
            and data.role != "lecturer"
            and db.scalar(
                select(func.count())
                .select_from(Membership)
                .where(Membership.course_id == cid, Membership.role == "lecturer", Membership.status == "active")
            )
            <= 1
        ):
            raise HTTPException(409, "A course must retain at least one lecturer.")
        m.role, m.status = data.role, "active"
    else:
        db.add(Membership(course_id=cid, user_id=target.id, role=data.role))
    db.commit()
    return {"status": "active"}


@router.get("/courses/{cid}/members")
def members(cid: str, db: DB, user: Actor):
    member(db, cid, user, True)
    return [
        {"id": u.id, "name": u.name, "email": u.email, "role": m.role, "status": m.status}
        for u, m in db.execute(
            select(User, Membership)
            .join(Membership)
            .where(Membership.course_id == cid, Membership.status == "active")
            .limit(500)
        )
    ]


@router.delete("/courses/{cid}/members/{target}", status_code=204)
def remove_member(cid: str, target: str, db: DB, user: Actor):
    member(db, cid, user, True)
    db.scalar(select(Course).where(Course.id == cid).with_for_update())
    m = require(db, Membership, (cid, target))
    if (
        m.role == "lecturer"
        and db.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.course_id == cid, Membership.role == "lecturer", Membership.status == "active")
        )
        <= 1
    ):
        raise HTTPException(409, "A course must retain at least one lecturer.")
    m.status = "removed"
    db.commit()


class InviteInput(BaseModel):
    email: EmailStr | None = None
    role: str = Field(default="student", pattern="^(student|lecturer)$")


@router.post("/courses/{cid}/invitations")
def invite(cid: str, data: InviteInput, db: DB, user: Actor):
    member(db, cid, user, True)
    token = secrets.token_urlsafe(32)
    db.add(
        Invitation(
            course_id=cid,
            token_hash=digest(token),
            email=str(data.email).lower() if data.email else None,
            role=data.role,
            expires_at=now() + timedelta(days=7),
        )
    )
    db.commit()
    return {"token": token, "url": f"{settings().app_origin}/invite/{token}", "expires_in_days": 7}


@router.get("/courses/{cid}/invitations")
def invitations(cid: str, db: DB, user: Actor):
    member(db, cid, user, True)
    return [
        {"id": i.id, "email": i.email, "role": i.role, "used": i.used, "expires_at": i.expires_at}
        for i in db.scalars(select(Invitation).where(Invitation.course_id == cid).limit(100))
    ]


class AcceptInvite(BaseModel):
    token: str = Field(max_length=200)


@router.post("/invitations/accept")
def accept_invite(data: AcceptInvite, db: DB, user: Actor):
    i = db.scalar(select(Invitation).where(Invitation.token_hash == digest(data.token)).with_for_update())
    if not i or i.used or i.expires_at.replace(tzinfo=timezone.utc) < now() or (i.email and i.email != user.email):
        raise HTTPException(404, "Invitation is expired, used or for a different email address.")
    if i.role == "lecturer" and user.role != "lecturer":
        raise HTTPException(403, "This invitation requires a lecturer account.")
    m = db.get(Membership, (i.course_id, user.id))
    if m:
        m.role, m.status = "lecturer" if m.role == "lecturer" and m.status == "active" else i.role, "active"
    else:
        db.add(Membership(course_id=i.course_id, user_id=user.id, role=i.role))
    i.used = True
    db.commit()
    return {"course_id": i.course_id}


class CourseSettings(BaseModel):
    poll_mode: str = Field(default="manual", pattern="^(manual|auto|suggested|end-only)$")
    poll_cooldown_seconds: int = Field(default=180, ge=60, le=3600)
    generated_answers: bool = False


@router.get("/courses/{cid}/settings")
def get_settings(cid: str, db: DB, user: Actor):
    member(db, cid, user, True)
    return require(db, Course, cid).settings_json


@router.patch("/courses/{cid}/settings")
def set_settings(cid: str, data: CourseSettings, db: DB, user: Actor):
    member(db, cid, user, True)
    from .models import LiveSession

    if db.scalar(select(LiveSession.id).where(LiveSession.course_id == cid, LiveSession.state == "live").limit(1)):
        raise HTTPException(409, "Course poll settings cannot change while a lecture is live. End the lecture first.")
    course = require(db, Course, cid)
    course.settings_json = data.model_dump()
    db.commit()
    return course.settings_json


class FolderInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: str | None = None


def check_folder(db, cid, parent_id, moving=None):
    seen = set()
    while parent_id:
        if parent_id == moving or parent_id in seen:
            raise HTTPException(409, "A folder cannot contain itself.")
        seen.add(parent_id)
        folder = require(db, Folder, parent_id)
        if folder.course_id != cid:
            raise HTTPException(404, "Folder not available in this course.")
        parent_id = folder.parent_id


@router.get("/courses/{cid}/folders")
def folders(cid: str, db: DB, user: Actor):
    member(db, cid, user)
    return list(db.scalars(select(Folder).where(Folder.course_id == cid).order_by(Folder.name).limit(1000)))


@router.post("/courses/{cid}/folders", status_code=201)
def create_folder(cid: str, data: FolderInput, db: DB, user: Actor):
    member(db, cid, user, True)
    check_folder(db, cid, data.parent_id)
    folder = Folder(course_id=cid, **data.model_dump())
    db.add(folder)
    db.commit()
    return folder


@router.patch("/folders/{fid}")
def edit_folder(fid: str, data: FolderInput, db: DB, user: Actor):
    folder = require(db, Folder, fid)
    member(db, folder.course_id, user, True)
    check_folder(db, folder.course_id, data.parent_id, fid)
    folder.name, folder.parent_id = data.name, data.parent_id
    db.commit()
    return folder


@router.delete("/folders/{fid}", status_code=204)
def delete_folder(fid: str, db: DB, user: Actor):
    folder = require(db, Folder, fid)
    member(db, folder.course_id, user, True)
    if db.scalar(select(Folder.id).where(Folder.parent_id == fid).limit(1)) or db.scalar(
        select(Resource.id).where(Resource.folder_id == fid).limit(1)
    ):
        raise HTTPException(409, "Move the folder's contents before deleting it.")
    db.delete(folder)
    db.commit()


ALLOWED = {
    ".pdf": "pdf",
    ".ppt": "pptx",
    ".pptx": "pptx",
    ".doc": "docx",
    ".docx": "docx",
    ".txt": "txt",
    ".json": "json",
    ".mp3": "audio",
    ".mp4": "video",
}


def resource_json(r, db=None):
    job = (
        db.scalar(
            select(Job)
            .where(Job.target_id == r.id, Job.type == "index_resource")
            .order_by(Job.created_at.desc())
            .limit(1)
        )
        if db
        else None
    )
    return {
        "index_status": job.status if job else "pending",
        "index_error": job.error_message if job else None,
        "id": r.id,
        "course_id": r.course_id,
        "folder_id": r.folder_id,
        "original_filename": r.original_filename,
        "kind": r.kind,
        "content_type": r.content_type,
        "size_bytes": r.size_bytes,
        "process_status": r.process_status,
        "error_message": r.error_message,
        "indexing_enabled": r.indexing_enabled,
        "page_count": len(r.pages),
        "created_at": r.created_at,
    }


@router.post("/courses/{cid}/resources", status_code=202)
async def upload(cid: str, db: DB, user: Actor, file: UploadFile, folder_id: str | None = Form(default=None)):
    member(db, cid, user, True)
    check_folder(db, cid, folder_id)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, "Upload PDF, PowerPoint, Word, TXT, JSON, MP3 or MP4.")
    key = f"{cid}/{uid()}/source{suffix}"
    path = private_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    sha = hashlib.sha256()
    head = b""
    try:
        with path.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > settings().max_upload_mb * 1024 * 1024:
                    raise HTTPException(413, "This file exceeds the upload limit.")
                if not head:
                    head = chunk[:8192]
                sha.update(chunk)
                output.write(chunk)
        valid = bool(size)
        if suffix == ".pdf":
            valid = head.startswith(b"%PDF-")
        elif suffix in {".pptx", ".docx"}:
            valid = zipfile.is_zipfile(path)
            if valid:
                with zipfile.ZipFile(path) as z:
                    valid = (
                        "ppt/presentation.xml" if suffix == ".pptx" else "word/document.xml"
                    ) in z.namelist() and sum(x.file_size for x in z.infolist()) < 500 * 1024 * 1024
        elif suffix in {".ppt", ".doc"}:
            valid = head.startswith(bytes.fromhex("d0cf11e0a1b11ae1"))
        elif suffix == ".mp4":
            valid = b"ftyp" in head[:32]
        elif suffix == ".mp3":
            valid = head.startswith(b"ID3") or (len(head) > 1 and head[0] == 255 and head[1] & 224 == 224)
        elif suffix in {".txt", ".json"}:
            codecs.getincrementaldecoder("utf-8")().decode(head, final=False)
            if suffix == ".json":
                json.loads(path.read_text())
        if not valid:
            raise HTTPException(415, "The file content does not match its extension.")
    except (UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile):
        path.unlink(missing_ok=True)
        raise HTTPException(415, "The file is not valid UTF-8 text or a valid JSON/Office document.")
    except Exception:
        path.unlink(missing_ok=True)
        raise
    mime = {
        "pdf": "application/pdf",
        "pptx": "application/octet-stream",
        "docx": "application/octet-stream",
        "txt": "text/plain",
        "json": "application/json",
        "audio": "audio/mpeg",
        "video": "video/mp4",
    }[ALLOWED[suffix]]
    r = Resource(
        course_id=cid,
        folder_id=folder_id,
        original_filename=Path(file.filename).name[:200],
        storage_key=key,
        content_type=mime,
        size_bytes=size,
        sha256=sha.hexdigest(),
        kind=ALLOWED[suffix],
    )
    db.add(r)
    db.flush()
    db.add(Job(type="ingest_document", course_id=cid, target_id=r.id))
    db.commit()
    return resource_json(r, db)


@router.get("/courses/{cid}/resources")
def resources(cid: str, db: DB, user: Actor):
    member(db, cid, user)
    return [
        resource_json(r, db)
        for r in db.scalars(
            select(Resource).where(Resource.course_id == cid).order_by(Resource.created_at.desc()).limit(500)
        )
    ]


@router.get("/resources/{rid}")
@router.get("/resources/{rid}/status")
def resource_status(rid: str, db: DB, user: Actor):
    r = require(db, Resource, rid)
    member(db, r.course_id, user)
    return resource_json(r, db)


@router.get("/resources/{rid}/download")
def download(rid: str, db: DB, user: Actor, inline: bool = False):
    r = require(db, Resource, rid)
    member(db, r.course_id, user)
    return FileResponse(
        private_path(r.storage_key),
        media_type=r.content_type,
        filename=None if inline and r.kind in {"audio", "video"} else r.original_filename,
    )


@router.get("/resources/{rid}/pages/{index}")
def page_image(rid: str, index: int, db: DB, user: Actor):
    r = require(db, Resource, rid)
    member(db, r.course_id, user)
    if index < 0 or index >= len(r.pages) or "image" not in r.pages[index]:
        raise HTTPException(404, "Slide not available yet.")
    return FileResponse(private_path(r.pages[index]["image"]), media_type="image/png")


class ResourceEdit(BaseModel):
    original_filename: str = Field(min_length=1, max_length=200)
    folder_id: str | None = None
    indexing_enabled: bool = True


@router.patch("/resources/{rid}")
def edit_resource(rid: str, data: ResourceEdit, db: DB, user: Actor):
    r = require(db, Resource, rid)
    member(db, r.course_id, user, True)
    check_folder(db, r.course_id, data.folder_id)
    for key, value in data.model_dump().items():
        setattr(r, key, value)
    from .ai.retrieval import enqueue_index

    enqueue_index(db, r.course_id, r.id)
    db.commit()
    return resource_json(r, db)


@router.delete("/resources/{rid}", status_code=204)
def delete_resource(rid: str, db: DB, user: Actor):
    r = require(db, Resource, rid)
    member(db, r.course_id, user, True)
    if db.scalar(select(Lecture.id).where(Lecture.slide_resource_id == rid).limit(1)):
        raise HTTPException(409, "This deck is used by a lecture. Disable indexing instead.")
    db.delete(r)
    db.commit()


@router.post("/resources/{rid}/reprocess", status_code=202)
def retry_resource(rid: str, db: DB, user: Actor):
    r = require(db, Resource, rid)
    member(db, r.course_id, user, True)
    existing = db.scalar(
        select(Job)
        .where(Job.target_id == rid, Job.type == "ingest_document", Job.status.in_(["queued", "processing"]))
        .with_for_update()
        .limit(1)
    )
    if existing and existing.status == "processing":
        raise HTTPException(409, "This resource is being processed. Wait for its result.")
    r.process_status = "queued"
    r.error_message = None
    if existing:
        existing.next_run_at = now()
        existing.attempts = 0
        existing.error_message = None
    else:
        db.add(Job(type="ingest_document", course_id=r.course_id, target_id=rid))
    db.commit()
    return resource_json(r, db)


class LectureInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    slide_resource_id: str


@router.post("/courses/{cid}/lectures", status_code=201)
def create_lecture(cid: str, data: LectureInput, db: DB, user: Actor):
    member(db, cid, user, True)
    deck = require(db, Resource, data.slide_resource_id)
    if deck.course_id != cid or deck.kind not in {"pdf", "pptx"} or deck.process_status != "ready" or not deck.pages:
        raise HTTPException(409, "Choose a processed PDF or PowerPoint deck with rendered slides.")
    lecture = Lecture(course_id=cid, **data.model_dump())
    db.add(lecture)
    db.commit()
    return lecture


@router.get("/courses/{cid}/lectures")
def lectures(cid: str, db: DB, user: Actor):
    member(db, cid, user)
    from .models import LiveSession

    rows = list(
        db.scalars(select(Lecture).where(Lecture.course_id == cid).order_by(Lecture.created_at.desc()).limit(200))
    )
    return [
        {
            "id": l.id,
            "title": l.title,
            "slide_resource_id": l.slide_resource_id,
            "session": (
                {"id": session.id, "state": session.state}
                if (session := db.scalar(select(LiveSession).where(LiveSession.lecture_id == l.id)))
                else None
            ),
        }
        for l in rows
    ]


@router.get("/lectures/{lid}")
def get_lecture(lid: str, db: DB, user: Actor):
    lecture = require(db, Lecture, lid)
    member(db, lecture.course_id, user)
    return lecture


@router.get("/lectures/{lid}/slides")
def lecture_slides(lid: str, db: DB, user: Actor):
    lecture = require(db, Lecture, lid)
    member(db, lecture.course_id, user)
    r = require(db, Resource, lecture.slide_resource_id)
    return [
        {"index": i, "image_url": f"/api/v1/resources/{r.id}/pages/{i}", "text": p["text"]}
        for i, p in enumerate(r.pages)
    ]


@router.get("/lectures/{lid}/outline")
def lecture_outline(lid: str, db: DB, user: Actor):
    lecture = require(db, Lecture, lid)
    member(db, lecture.course_id, user, True)
    return {
        "outline": lecture.outline_json,
        "jobs": [
            {"status": j.status, "error": j.error_message}
            for j in db.scalars(
                select(Job)
                .where(Job.target_id == lid, Job.type == "generate_outline")
                .order_by(Job.created_at.desc())
                .limit(1)
            )
        ],
    }


@router.post("/lectures/{lid}/prepare")
def prepare_lecture(lid: str, db: DB, user: Actor):
    lecture = require(db, Lecture, lid)
    member(db, lecture.course_id, user, True)
    return resource_json(require(db, Resource, lecture.slide_resource_id))


@router.post("/resources/{rid}/reindex", status_code=202)
def reindex(rid: str, db: DB, user: Actor):
    r = require(db, Resource, rid)
    member(db, r.course_id, user, True)
    from .ai.retrieval import enqueue_index

    enqueue_index(db, r.course_id, r.id)
    db.commit()
    return {"status": "queued"}


@router.get("/resources/{rid}/transcript")
def resource_transcript(rid: str, db: DB, user: Actor):
    r = require(db, Resource, rid)
    member(db, r.course_id, user)
    from .models import Transcript

    return [
        {"id": t.id, "text": t.text, "start_ms": t.start_ms, "end_ms": t.end_ms, "timing": t.timing}
        for t in db.scalars(
            select(Transcript).where(Transcript.resource_id == rid).order_by(Transcript.start_ms).limit(10000)
        )
    ]
