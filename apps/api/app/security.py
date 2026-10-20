import hashlib
import uuid
from datetime import datetime, timezone
from typing import Annotated
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .db import database
from .models import User, LoginSession, Membership, Course

DB = Annotated[Session, Depends(database)]


def digest(token: str):
    return hashlib.sha256(token.encode()).hexdigest()


def authenticate(db, token):
    session = db.get(LoginSession, digest(token or ""))
    if not session or session.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(401, "Please sign in to continue.")
    return db.get(User, session.user_id)


def current_user(request: Request, db: DB):
    return authenticate(db, request.cookies.get("lectureloop_session"))


Actor = Annotated[User, Depends(current_user)]


def member(db, course_id, user, lecturer=False):
    try:
        uuid.UUID(str(course_id))
    except ValueError:
        raise HTTPException(404, "Course not found.")
    course = db.get(Course, course_id)
    membership = db.get(Membership, (course_id, user.id))
    if not course or not membership or membership.status != "active":
        raise HTTPException(404, "Course not available. Request membership or ask a lecturer for an invitation.")
    if lecturer and membership.role != "lecturer":
        raise HTTPException(403, "Only a course lecturer can do this.")
    return membership
