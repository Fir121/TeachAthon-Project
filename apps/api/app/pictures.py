"""Bounded local picture uploads, separate from course resource ingestion and AI."""

import io
import warnings
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from .models import User, Course, Lecture, uid
from .security import DB, Actor, member
from .materials import private_path, require

router = APIRouter(prefix="/api/v1")
MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 20_000_000


def image_url(endpoint, key):
    return f"/api/v1{endpoint}?v={Path(key).stem}" if key else None


def normalized_picture(file, size):
    content = file.file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "Choose an image smaller than 5 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as probe:
                if probe.width * probe.height > MAX_PIXELS:
                    raise HTTPException(413, "Choose an image with at most 20 million pixels.")
                probe.verify()
            with Image.open(io.BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as source:
                image = ImageOps.exif_transpose(source).convert("RGBA")
                image.thumbnail((size, size), Image.Resampling.LANCZOS)
                image.info.clear()
                output = io.BytesIO()
                image.save(output, "WEBP", quality=85, method=4, exif=b"", xmp=b"")
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise HTTPException(415, "Choose a valid JPEG, PNG or WebP image.") from None


def save_picture(db, owner, column, endpoint, file, size):
    content = normalized_picture(file, size)
    old = getattr(owner, column)
    key = f"images/{owner.__tablename__}/{owner.id}/{uid()}.webp"
    path = private_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    setattr(owner, column, key)
    try:
        db.commit()
    except Exception:
        path.unlink(missing_ok=True)  # Only this request's newly-created file.
        raise
    if old and old.startswith("images/"):
        private_path(old).unlink(missing_ok=True)
    return {"url": image_url(endpoint, key)}


def remove_picture(db, owner, column):
    old = getattr(owner, column)
    setattr(owner, column, None)
    db.commit()
    if old and old.startswith("images/"):
        private_path(old).unlink(missing_ok=True)


def picture(owner, column):
    key = getattr(owner, column)
    if not key or not private_path(key).is_file():
        raise HTTPException(404, "This image is no longer available.")
    return FileResponse(private_path(key), media_type="image/webp", headers={"Cache-Control": "private, max-age=3600"})


def locked(db, cls, identifier):
    return db.scalar(
        select(cls).where(cls.id == identifier).with_for_update().execution_options(populate_existing=True)
    )


@router.get("/auth/me/avatar")
def avatar(user: Actor):
    return picture(user, "avatar_key")


@router.post("/auth/me/avatar")
def upload_avatar(db: DB, user: Actor, file: UploadFile):
    return save_picture(db, locked(db, User, user.id), "avatar_key", "/auth/me/avatar", file, 512)


@router.delete("/auth/me/avatar", status_code=204)
def delete_avatar(db: DB, user: Actor):
    remove_picture(db, locked(db, User, user.id), "avatar_key")


@router.get("/courses/{cid}/banner")
def course_banner(cid: str, db: DB, user: Actor):
    member(db, cid, user)
    return picture(db.get(Course, cid), "banner_key")


@router.post("/courses/{cid}/banner")
def upload_course_banner(cid: str, db: DB, user: Actor, file: UploadFile):
    member(db, cid, user, True)
    return save_picture(db, locked(db, Course, cid), "banner_key", f"/courses/{cid}/banner", file, 2048)


@router.delete("/courses/{cid}/banner", status_code=204)
def delete_course_banner(cid: str, db: DB, user: Actor):
    member(db, cid, user, True)
    remove_picture(db, locked(db, Course, cid), "banner_key")


def lecture_access(db, lid, user, write=False):
    lecture = require(db, Lecture, lid)
    member(db, lecture.course_id, user, write)
    return locked(db, Lecture, lid) if write else lecture


@router.get("/lectures/{lid}/banner")
def lecture_banner(lid: str, db: DB, user: Actor):
    return picture(lecture_access(db, lid, user), "banner_key")


@router.post("/lectures/{lid}/banner")
def upload_lecture_banner(lid: str, db: DB, user: Actor, file: UploadFile):
    return save_picture(db, lecture_access(db, lid, user, True), "banner_key", f"/lectures/{lid}/banner", file, 2048)


@router.delete("/lectures/{lid}/banner", status_code=204)
def delete_lecture_banner(lid: str, db: DB, user: Actor):
    remove_picture(db, lecture_access(db, lid, user, True), "banner_key")
