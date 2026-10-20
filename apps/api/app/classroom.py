import asyncio
import secrets
from collections import defaultdict
from threading import Lock
from datetime import timezone
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select, func, update
from sqlalchemy.orm.attributes import set_committed_value
from .config import settings
from .db import SessionLocal
from .models import LiveSession, Lecture, Resource, Course, SessionEvent, Poll, PollVote, Job, now
from .security import DB, Actor, member, authenticate
from .materials import require

router = APIRouter()
PRESENCE = defaultdict(dict)
PRESENCE_LOCK = Lock()
LABELS = ["Understood", "Somewhat understood", "Unsure or confused", "Completely lost"]


def offset(session):
    return max(0, int((now() - session.started_at.replace(tzinfo=timezone.utc)).total_seconds() * 1000))


def live(db, sid, user, teacher=False, active=False, lock=False):
    from uuid import UUID

    try:
        UUID(sid)
    except ValueError:
        raise HTTPException(404, "Session not found.")
    session = (
        db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
        if lock
        else db.get(LiveSession, sid)
    )
    if not session:
        raise HTTPException(404, "Lecture session not found.")
    membership = member(db, session.course_id, user, teacher)
    if active and session.state != "live":
        raise HTTPException(409, "This lecture has ended and cannot be restarted.")
    return session, membership


def emit(db, session, kind, payload=None, audience="course", at_ms=None):
    # Allocate in the database: a locked ORM instance can still hold stale counters
    # after background work when expire_on_commit=False.
    sequence, public_sequence = db.execute(
        update(LiveSession)
        .where(LiveSession.id == session.id)
        .values(
            event_sequence=LiveSession.event_sequence + 1,
            public_sequence=LiveSession.public_sequence + (1 if audience == "course" else 0),
        )
        .returning(LiveSession.event_sequence, LiveSession.public_sequence),
        execution_options={"synchronize_session": False},
    ).one()
    set_committed_value(session, "event_sequence", sequence)
    set_committed_value(session, "public_sequence", public_sequence)
    event = SessionEvent(
        session_id=session.id,
        sequence=session.event_sequence,
        public_sequence=session.public_sequence,
        event_type=kind,
        payload_json=payload or {},
        audience=audience,
        offset_ms=offset(session) if at_ms is None else at_ms,
    )
    db.add(event)
    return event


def poll_json(db, poll, user, teacher):
    vote = db.get(PollVote, (poll.id, user.id))
    data = {
        "id": poll.id,
        "session_id": poll.session_id,
        "prompt": poll.prompt,
        "status": poll.status,
        "labels": LABELS,
        "my_vote": vote.option_index if vote else None,
        "opened_at": poll.opened_at,
    }
    if teacher:
        counts = dict(
            db.execute(
                select(PollVote.option_index, func.count())
                .where(PollVote.poll_id == poll.id)
                .group_by(PollVote.option_index)
            ).all()
        )
        data["counts"] = [counts.get(i, 0) for i in range(4)]
    return data


def session_json(session, teacher=False):
    return {
        "id": session.id,
        "lecture_id": session.lecture_id,
        "course_id": session.course_id,
        "state": session.state,
        "started_at": session.started_at.replace(tzinfo=timezone.utc),
        "ended_at": session.ended_at,
        "active_slide_index": session.active_slide_index,
        "seq": session.event_sequence if teacher else session.public_sequence,
        "recording_enabled": session.recording_enabled,
        "recording_state": session.recording_state,
        "transcript_state": session.transcript_state,
        "context_paused": session.context_paused,
        **({"topic": session.topic_json, "poll_config": session.poll_config} if teacher else {}),
    }


class StartInput(BaseModel):
    recording_enabled: bool = False


@router.post("/api/v1/lectures/{lid}/sessions/start")
def start(lid: str, data: StartInput, db: DB, user: Actor):
    lecture = require(db, Lecture, lid)
    member(db, lecture.course_id, user, True)
    db.scalar(select(Lecture).where(Lecture.id == lid).with_for_update())
    existing = db.scalar(select(LiveSession).where(LiveSession.lecture_id == lid))
    if existing:
        if existing.state == "ended":
            raise HTTPException(409, "This lecture has already ended. Create a new lecture to teach again.")
        return session_json(existing, True)
    resource = require(db, Resource, lecture.slide_resource_id)
    if resource.process_status != "ready" or not resource.pages:
        raise HTTPException(409, "The slide deck is not ready.")
    session = LiveSession(
        lecture_id=lid,
        course_id=lecture.course_id,
        join_code=secrets.token_hex(4).upper(),
        recording_enabled=data.recording_enabled,
        recording_state="awaiting_audio" if data.recording_enabled else "disabled",
        poll_config=require(db, Course, lecture.course_id).settings_json.copy(),
    )
    db.add(session)
    db.flush()
    emit(db, session, "session.started", at_ms=0)
    emit(db, session, "slide.changed", {"index": 0}, at_ms=0)
    db.commit()
    return session_json(session, True)


@router.post("/api/v1/sessions/{sid}/end")
def end(sid: str, db: DB, user: Actor):
    session, _ = live(db, sid, user, True, lock=True)
    if session.state == "ended":
        return session_json(session, True)
    session.state = "ended"
    session.ended_at = now()
    session.transcript_state = "off"
    for p in db.scalars(select(Poll).where(Poll.session_id == sid, Poll.status == "open")):
        p.status = "closed"
        p.closed_at = now()
    if session.recording_enabled:
        session.recording_state = "queued"
        db.add(Job(type="assemble_recording", course_id=session.course_id, target_id=sid))
    from .models import Question
    from .ai.retrieval import enqueue_index

    enqueue_index(db, session.course_id, sid, "index_session")
    for q in db.scalars(select(Question).where(Question.session_id == sid, Question.state != "dismissed")):
        enqueue_index(db, session.course_id, q.id, "match_answer_excerpt")
    emit(db, session, "session.ended")
    db.commit()
    return session_json(session, True)


@router.get("/api/v1/sessions/{sid}/snapshot")
def snapshot(sid: str, db: DB, user: Actor):
    from .questions import visible_questions, question_json

    session, m = live(db, sid, user)
    teacher = m.role == "lecturer"
    lecture = require(db, Lecture, session.lecture_id)
    r = require(db, Resource, lecture.slide_resource_id)
    poll = db.scalar(select(Poll).where(Poll.session_id == sid, Poll.status == "open"))
    from .models import Transcript

    latest = db.scalar(
        select(Transcript).where(Transcript.session_id == sid).order_by(Transcript.end_ms.desc()).limit(1)
    )
    annotations = list(
        db.scalars(
            select(SessionEvent)
            .where(SessionEvent.session_id == sid, SessionEvent.event_type == "annotation.added")
            .order_by(SessionEvent.sequence)
            .limit(2000)
        )
    )
    return {
        "session": session_json(session, teacher),
        "lecture": {"id": lecture.id, "title": lecture.title},
        "membership": m.role,
        "slides": [{"index": i, "image_url": f"/api/v1/resources/{r.id}/pages/{i}"} for i, p in enumerate(r.pages)],
        "poll": poll_json(db, poll, user, teacher) if poll else None,
        "questions": [
            question_json(db, q, user, teacher) for q in visible_questions(db, session.course_id, teacher, sid)
        ],
        **({"participants": len(PRESENCE.get(sid, {}))} if teacher else {}),
        "latest_caption": latest.text if latest else None,
        "annotations": [
            {"index": e.payload_json["index"], "stroke": e.payload_json["stroke"], "offset_ms": e.offset_ms}
            for e in annotations
        ],
    }


@router.get("/api/v1/sessions/{sid}/join-info")
def join_info(sid: str, db: DB, user: Actor):
    session, _ = live(db, sid, user)
    return {"code": session.join_code, "url": f"{settings().app_origin}/join/{session.join_code}"}


class JoinInput(BaseModel):
    code: str = Field(max_length=20)


@router.post("/api/v1/sessions/join")
def join_session(data: JoinInput, db: DB, user: Actor):
    session = db.scalar(select(LiveSession).where(LiveSession.join_code == data.code.strip().upper()))
    if not session:
        raise HTTPException(404, "Check the join code and try again.")
    member(db, session.course_id, user)
    return {"session_id": session.id}


class SlideInput(BaseModel):
    index: int = Field(ge=0)


@router.post("/api/v1/sessions/{sid}/slides/change")
def change_slide(sid: str, data: SlideInput, db: DB, user: Actor):
    session, _ = live(db, sid, user, True, True, True)
    lecture = require(db, Lecture, session.lecture_id)
    deck = require(db, Resource, lecture.slide_resource_id)
    if data.index >= len(deck.pages):
        raise HTTPException(422, "Slide index is out of range.")
    session.active_slide_index = data.index
    emit(db, session, "slide.changed", data.model_dump())
    from .ai.retrieval import enqueue_index

    enqueue_index(db, session.course_id, sid, "infer_topic")
    db.commit()
    return {"index": data.index}


class AnnotationInput(BaseModel):
    index: int = Field(ge=0)
    stroke: list[list[float]] = Field(max_length=2000)


@router.post("/api/v1/sessions/{sid}/annotations")
def annotate(sid: str, data: AnnotationInput, db: DB, user: Actor):
    session, _ = live(db, sid, user, True, True, True)
    if data.index != session.active_slide_index or any(
        len(p) != 2 or any(v < 0 or v > 1 for v in p) for p in data.stroke
    ):
        raise HTTPException(422, "Invalid annotation coordinates or slide.")
    emit(db, session, "annotation.added", data.model_dump())
    db.commit()
    return {"saved": True}


class PollInput(BaseModel):
    prompt: str = Field(default="How is this topic landing?", min_length=1, max_length=200)


def open_poll(db, session, prompt="How is this topic landing?", source="lecturer"):
    for p in db.scalars(select(Poll).where(Poll.session_id == session.id, Poll.status == "open")):
        p.status = "superseded"
        p.closed_at = now()
    db.flush()
    poll = Poll(session_id=session.id, prompt=prompt, created_by=source)
    db.add(poll)
    db.flush()
    emit(db, session, "poll.opened", {"id": poll.id})
    return poll


@router.post("/api/v1/sessions/{sid}/polls", status_code=201)
def create_poll(sid: str, data: PollInput, db: DB, user: Actor):
    session, _ = live(db, sid, user, True, True, True)
    poll = open_poll(db, session, data.prompt)
    db.commit()
    return poll_json(db, poll, user, True)


@router.get("/api/v1/sessions/{sid}/polls")
def polls(sid: str, db: DB, user: Actor):
    session, m = live(db, sid, user)
    return [
        poll_json(db, p, user, m.role == "lecturer")
        for p in db.scalars(select(Poll).where(Poll.session_id == sid).order_by(Poll.opened_at.desc()).limit(100))
    ]


class VoteInput(BaseModel):
    option_index: int = Field(ge=0, lt=4)


@router.post("/api/v1/polls/{pid}/vote")
def vote(pid: str, data: VoteInput, db: DB, user: Actor):
    p = require(db, Poll, pid)
    session, m = live(db, p.session_id, user, active=True, lock=True)
    db.refresh(p)
    if m.role != "student":
        raise HTTPException(403, "Only students vote in understanding polls.")
    if p.status != "open":
        raise HTTPException(409, "This poll is closed.")
    v = db.get(PollVote, (pid, user.id))
    if v:
        v.option_index = data.option_index
    else:
        db.add(PollVote(poll_id=pid, user_id=user.id, option_index=data.option_index))
    emit(db, session, "poll.results.updated", audience="lecturer")
    db.commit()
    return {"option_index": data.option_index}


@router.post("/api/v1/polls/{pid}/close")
def close_poll(pid: str, db: DB, user: Actor):
    p = require(db, Poll, pid)
    session, _ = live(db, p.session_id, user, True, lock=True)
    p.status = "closed"
    p.closed_at = now()
    emit(db, session, "poll.closed", {"id": pid})
    db.commit()
    return poll_json(db, p, user, True)


@router.get("/api/v1/polls/{pid}/results")
def results(pid: str, db: DB, user: Actor):
    p = require(db, Poll, pid)
    live(db, p.session_id, user, True)
    return poll_json(db, p, user, True)


@router.post("/api/v1/sessions/{sid}/context/{action}")
def context_control(sid: str, action: str, db: DB, user: Actor):
    s, _ = live(db, sid, user, True, True, True)
    if action not in {"pause", "resume"}:
        raise HTTPException(404, "Unknown action.")
    s.context_paused = action == "pause"
    emit(db, s, "context.updated", audience="lecturer")
    db.commit()
    return {"paused": s.context_paused}


@router.get("/api/v1/sessions/{sid}/timeline")
def timeline(sid: str, db: DB, user: Actor):
    s, _ = live(db, sid, user)
    return [
        {"type": e.event_type, "offset_ms": e.offset_ms, "payload": e.payload_json}
        for e in db.scalars(
            select(SessionEvent)
            .where(SessionEvent.session_id == sid, SessionEvent.event_type.in_(["slide.changed", "annotation.added"]))
            .order_by(SessionEvent.sequence)
        )
    ]


@router.websocket("/ws/sessions/{sid}")
async def session_socket(ws: WebSocket, sid: str):
    origin = ws.headers.get("origin")
    if origin and origin != settings().app_origin:
        await ws.close(code=1008)
        return
    presence_user = None
    try:
        with SessionLocal() as db:
            user = authenticate(db, ws.cookies.get("lectureloop_session"))
            session, m = live(db, sid, user)
            cursor = session.event_sequence
            teacher = m.role == "lecturer"
        await ws.accept()
        presence_user = user.id
        with PRESENCE_LOCK:
            PRESENCE[sid][user.id] = PRESENCE[sid].get(user.id, 0) + 1
        await ws.send_json({"v": 1, "type": "snapshot.required"})
        while True:
            with SessionLocal() as db:
                user = authenticate(db, ws.cookies.get("lectureloop_session"))
                session, m = live(db, sid, user)
                teacher = m.role == "lecturer"
                events = list(
                    db.scalars(
                        select(SessionEvent)
                        .where(SessionEvent.session_id == sid, SessionEvent.sequence > cursor)
                        .order_by(SessionEvent.sequence)
                        .limit(100)
                    )
                )
                for e in events:
                    cursor = e.sequence
                    if e.audience == "lecturer" and not teacher:
                        continue
                    await ws.send_json(
                        {
                            "v": 1,
                            "event_id": e.id,
                            "session_id": sid,
                            "seq": e.sequence if teacher else e.public_sequence,
                            "type": e.event_type,
                            "at": e.created_at.replace(tzinfo=timezone.utc).isoformat(),
                            "payload": e.payload_json,
                        }
                    )
            await asyncio.sleep(0.5)
            # Poll the client as well so disconnects don't leave idle loops alive.
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=0.01)
            except asyncio.TimeoutError:
                pass
    except (WebSocketDisconnect, HTTPException, RuntimeError):
        try:
            await ws.close(code=1008)
        except RuntimeError:
            pass

    finally:
        if presence_user:
            with PRESENCE_LOCK:
                count = PRESENCE[sid].get(presence_user, 1) - 1
                if count:
                    PRESENCE[sid][presence_user] = count
                else:
                    PRESENCE[sid].pop(presence_user, None)
                if not PRESENCE[sid]:
                    PRESENCE.pop(sid, None)
