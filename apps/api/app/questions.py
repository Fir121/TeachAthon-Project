import hashlib
import json
import os
import re
import secrets
from fastapi import APIRouter, HTTPException, Query
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from .config import settings
from .models import Question, QuestionVote, Answer, Resource, User, LiveSession, now
from .security import DB, Actor, member
from .materials import require, private_path
from .classroom import live, emit

router = APIRouter(prefix="/api/v1")


def signer():
    key = private_path(".preflight-key")
    key.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(48))
    except FileExistsError:
        pass
    return URLSafeTimedSerializer(key.read_text(), salt="lectureloop-preflight-v1")


class PreflightInput(BaseModel):
    text: str = Field(min_length=3, max_length=8000)
    visibility: str = Field(default="public", pattern="^(public|private)$")
    anonymous: bool = False
    session_id: str | None = None


class QuestionInput(PreflightInput):
    preflight_token: str = Field(max_length=2000)


def fingerprint(cid, data):
    raw = {
        "course_id": cid,
        "text": data.text,
        "visibility": data.visibility,
        "anonymous": data.anonymous,
        "session_id": data.session_id,
    }
    return hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()


def words(text):
    stop = {
        "what",
        "when",
        "where",
        "which",
        "there",
        "their",
        "about",
        "could",
        "would",
        "should",
        "please",
        "explain",
        "does",
        "with",
        "this",
        "that",
        "from",
        "have",
        "into",
        "your",
        "then",
        "than",
        "they",
        "them",
        "the",
        "and",
        "are",
        "for",
        "how",
        "why",
        "can",
        "you",
    }
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in stop}


def lexical_score(query, text):
    a, b = words(query), words(text)
    return len(a & b) / len(a) if a else 0


def baseline_search(db, cid, text):
    matches = []
    for r in db.scalars(
        select(Resource)
        .where(Resource.course_id == cid, Resource.indexing_enabled.is_(True), Resource.process_status == "ready")
        .limit(500)
    ):
        for i, p in enumerate(r.pages):
            score = lexical_score(text, p.get("text", ""))
            if score >= 0.45 and len(words(text) & words(p.get("text", ""))) >= 2:
                matches.append(
                    {
                        "source_id": r.id,
                        "source_type": "resource",
                        "title": r.original_filename,
                        "excerpt": p["text"][:700],
                        "page_number": i + 1,
                        "score": score,
                        "category": "relevant_material",
                        "url": f"/resources/{r.id}?page={i + 1}",
                    }
                )
    for q in db.scalars(
        select(Question)
        .where(Question.course_id == cid, Question.visibility == "public", Question.state != "dismissed")
        .limit(500)
    ):
        score = lexical_score(text, q.body_display)
        if score >= 0.6 and len(words(text) & words(q.body_display)) >= 2:
            matches.append(
                {
                    "source_id": q.id,
                    "source_type": "question",
                    "title": "Existing public question",
                    "excerpt": q.body_display[:700],
                    "score": score,
                    "category": "similar_public_question",
                    "url": f"/courses/{cid}/discussions?question={q.id}",
                }
            )
    return sorted(matches, key=lambda m: m["score"], reverse=True)[:8]


@router.post("/courses/{cid}/questions/preflight")
async def preflight(cid: str, data: PreflightInput, db: DB, user: Actor):
    member(db, cid, user)
    if data.session_id:
        session, _ = live(db, data.session_id, user)
        if session.course_id != cid:
            raise HTTPException(404, "Session is not in this course.")
    import asyncio
    from .ai.retrieval import search, optional_answer

    error = None
    generated = None
    method = "course keyword search"
    try:
        matches, warnings = await asyncio.wait_for(search(db, cid, data.text), timeout=5)
        if settings().openai_api_key:
            method = "semantic and keyword course search"
        if warnings:
            error = " ".join(warnings)
        try:
            generated = await optional_answer(db, cid, data.text, matches)
        except Exception:
            error = (error or "") + " Optional AI summary is unavailable; use the original sources."
    except Exception:
        matches = []
        error = "Source search is unavailable or timed out. Retry or post your question anyway."
    proof = signer().dumps({"fingerprint": fingerprint(cid, data), "failed": bool(error)})
    return {
        "preflight_token": proof,
        "status": "failed" if error else "complete",
        "error": error,
        "matches": matches,
        "method": method,
        "generated_answer": generated,
    }


def visible_questions(db, cid, teacher, sid=None, sort="newest", q=""):
    stmt = select(Question).where(Question.course_id == cid, Question.state != "dismissed")
    if not teacher:
        stmt = stmt.where(Question.visibility == "public")
    if sid:
        stmt = stmt.where(Question.session_id == sid)
    if q:
        stmt = stmt.where(Question.body_display.ilike(f"%{q[:150]}%"))
    if sort == "unanswered":
        stmt = stmt.where(Question.state == "open")
    if sort == "votes":
        stmt = stmt.order_by(
            select(func.count())
            .select_from(QuestionVote)
            .where(QuestionVote.question_id == Question.id)
            .correlate(Question)
            .scalar_subquery()
            .desc()
        )
    return list(db.scalars(stmt.order_by(Question.created_at.desc()).limit(200)))


def question_json(db, q, user, teacher):
    author = db.get(User, q.author_id) if q.author_id else None
    votes = (
        db.scalar(select(func.count()).select_from(QuestionVote).where(QuestionVote.question_id == q.id))
        if q.visibility == "public"
        else None
    )
    return {
        "id": q.id,
        "course_id": q.course_id,
        "session_id": q.session_id,
        "text": q.body_display,
        "original": q.body_original if teacher else None,
        "ai_modified": q.ai_modified,
        "anonymous": q.anonymous,
        "author": author.name if author else "Anonymous",
        "author_id": q.author_id if not q.anonymous else None,
        "visibility": q.visibility,
        "state": q.state,
        "created_at": q.created_at,
        "can_edit": teacher or (not q.anonymous and q.author_id == user.id),
        "votes": votes,
        "my_vote": bool(db.get(QuestionVote, (q.id, user.id))),
        "match": q.match_json if teacher or not q.match_json.get("possibly_addressed") else {"state": "unavailable"},
    }


def question_access(db, qid, user, teacher_only=False, author_write=False, lock=False):
    q = require(db, Question, qid)
    m = member(db, q.course_id, user, teacher_only)
    if (
        q.visibility == "private"
        and m.role != "lecturer"
        and not (author_write and not q.anonymous and q.author_id == user.id)
    ):
        raise HTTPException(404, "Question not available.")
    if lock and q.session_id:
        live(db, q.session_id, user, lock=True)
    return q, m


def question_event(db, q, kind):
    from .ai.retrieval import enqueue_index

    enqueue_index(db, q.course_id, q.id, "index_question")
    if q.session_id:
        session = db.scalar(select(LiveSession).where(LiveSession.id == q.session_id).with_for_update())
        emit(db, session, kind, {"id": q.id}, "lecturer" if q.visibility == "private" else "course")


@router.post("/courses/{cid}/questions", status_code=201)
def create_question(cid: str, data: QuestionInput, db: DB, user: Actor):
    member(db, cid, user)
    try:
        proof = signer().loads(data.preflight_token, max_age=600)
        if proof["fingerprint"] != fingerprint(cid, data):
            raise BadSignature("mismatch")
    except (BadSignature, SignatureExpired, KeyError):
        raise HTTPException(409, "Search course sources for this question before posting. The check may have expired.")
    if data.session_id:
        session, _ = live(db, data.session_id, user, active=True, lock=True)
        if session.course_id != cid:
            raise HTTPException(404, "Session is not in this course.")
    q = Question(
        course_id=cid,
        session_id=data.session_id,
        body_original=data.text,
        body_display=data.text,
        author_id=None if data.anonymous else user.id,
        anonymous=data.anonymous,
        visibility=data.visibility,
    )
    db.add(q)
    db.flush()
    question_event(db, q, "question.created")
    from .ai.retrieval import enqueue_index

    enqueue_index(db, cid, q.id, "group_questions")
    db.commit()
    # Anonymous submissions persist no requester identifier, preflight record or audit linkage.
    return question_json(db, q, user, member(db, cid, user).role == "lecturer")


@router.get("/courses/{cid}/questions")
def list_questions(cid: str, db: DB, user: Actor, session_id: str | None = None, sort: str = "newest", q: str = ""):
    m = member(db, cid, user)
    return [
        question_json(db, row, user, m.role == "lecturer")
        for row in visible_questions(db, cid, m.role == "lecturer", session_id, sort, q)
    ]


@router.get("/questions/{qid}")
def get_question(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user)
    return question_json(db, q, user, m.role == "lecturer")


class QuestionEdit(BaseModel):
    text: str = Field(min_length=3, max_length=8000)


@router.patch("/questions/{qid}")
def edit_question(qid: str, data: QuestionEdit, db: DB, user: Actor):
    q, m = question_access(db, qid, user, author_write=True, lock=True)
    if m.role != "lecturer" and (q.anonymous or q.author_id != user.id):
        raise HTTPException(403, "Only named authors or course lecturers can edit this question.")
    q.body_display = data.text
    if not q.ai_modified:
        q.body_original = data.text
    from .models import SourceChunk
    from sqlalchemy import delete

    db.execute(delete(SourceChunk).where(SourceChunk.question_id == qid))
    q.edited_at = now()
    question_event(db, q, "question.updated")
    from .ai.retrieval import enqueue_index

    enqueue_index(db, q.course_id, q.id, "group_questions")
    db.commit()
    return question_json(db, q, user, m.role == "lecturer")


@router.delete("/questions/{qid}", status_code=204)
def delete_question(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user, author_write=True, lock=True)
    if m.role != "lecturer" and (q.anonymous or q.author_id != user.id):
        raise HTTPException(403, "Only named authors or course lecturers can delete this question.")
    question_event(db, q, "question.updated")
    db.delete(q)
    db.commit()


@router.post("/questions/{qid}/vote")
def vote_question(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user, lock=True)
    if q.visibility != "public":
        raise HTTPException(403, "Private questions cannot be upvoted.")
    db.scalar(select(Question).where(Question.id == qid).with_for_update())
    if not db.get(QuestionVote, (qid, user.id)):
        db.add(QuestionVote(question_id=qid, user_id=user.id))
    question_event(db, q, "question.updated")
    db.commit()
    return {"voted": True}


@router.delete("/questions/{qid}/vote", status_code=204)
def unvote_question(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user, lock=True)
    vote = db.get(QuestionVote, (qid, user.id))
    if vote:
        db.delete(vote)
    question_event(db, q, "question.updated")
    db.commit()


@router.post("/questions/{qid}/resolve")
def resolve(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user, True, lock=True)
    q.state = "answered"
    q.match_json = {"state": "pending"} if q.session_id else {"state": "unavailable"}
    question_event(db, q, "question.answered")
    from .ai.retrieval import enqueue_index

    enqueue_index(db, q.course_id, q.id, "match_answer_excerpt")
    db.commit()
    return question_json(db, q, user, True)


@router.post("/questions/{qid}/dismiss")
def dismiss(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user, True, lock=True)
    q.state = "dismissed"
    question_event(db, q, "question.updated")
    db.commit()
    return {"state": "dismissed"}


class AnswerInput(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    visibility: str = Field(default="public", pattern="^(public|private)$")
    anonymous: bool = False


@router.post("/questions/{qid}/answer", status_code=201)
@router.post("/questions/{qid}/comments", status_code=201)
def answer(qid: str, data: AnswerInput, db: DB, user: Actor):
    q, m = question_access(db, qid, user, lock=True)
    if m.role != "lecturer" and data.visibility == "private":
        raise HTTPException(403, "Only lecturers can add a private written answer.")
    visibility = "private" if q.visibility == "private" else data.visibility
    a = Answer(
        question_id=qid,
        author_id=None if data.anonymous else user.id,
        anonymous=data.anonymous,
        body=data.body,
        visibility=visibility,
        lecturer_authored=m.role == "lecturer",
    )
    db.add(a)
    if m.role == "lecturer":
        q.state = "answered"
    from .ai.retrieval import enqueue_index

    enqueue_index(db, q.course_id, q.id, "index_question")
    if visibility == "public":
        question_event(db, q, "question.answered" if m.role == "lecturer" else "question.updated")
    db.commit()
    return {"id": a.id}


@router.get("/questions/{qid}/answers")
def answers(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user)
    stmt = select(Answer).where(Answer.question_id == qid)
    if m.role != "lecturer":
        stmt = stmt.where(Answer.visibility == "public")
    return [
        {
            "id": a.id,
            "body": a.body,
            "visibility": a.visibility,
            "lecturer_authored": a.lecturer_authored,
            "can_edit": m.role == "lecturer" or (not a.anonymous and a.author_id == user.id),
            "author": db.get(User, a.author_id).name if a.author_id else "Anonymous",
            "created_at": a.created_at,
        }
        for a in db.scalars(stmt.order_by(Answer.created_at).limit(200))
    ]


@router.get("/questions/{qid}/match-status")
def match_status(qid: str, db: DB, user: Actor):
    q, m = question_access(db, qid, user)
    return q.match_json


@router.get("/courses/{cid}/search")
async def course_search(cid: str, db: DB, user: Actor, q: str = Query(min_length=3, max_length=8000)):
    member(db, cid, user)
    from .ai.retrieval import search

    matches, warnings = await search(db, cid, q)
    return {"matches": matches, "warnings": warnings}


class ReplyEdit(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


@router.patch("/answers/{aid}")
def edit_reply(aid: str, data: ReplyEdit, db: DB, user: Actor):
    a = require(db, Answer, aid)
    q, m = question_access(db, a.question_id, user, lock=True)
    if a.visibility == "private" and m.role != "lecturer":
        raise HTTPException(404, "Reply not available.")
    if m.role != "lecturer" and (a.anonymous or a.author_id != user.id):
        raise HTTPException(403, "Only a named author or lecturer can edit this reply.")
    a.body = data.body
    from .models import SourceChunk
    from sqlalchemy import delete

    db.execute(delete(SourceChunk).where(SourceChunk.answer_id == aid))
    from .ai.retrieval import enqueue_index

    enqueue_index(db, q.course_id, q.id, "index_question")
    db.commit()
    return {"updated": True}


@router.delete("/answers/{aid}", status_code=204)
def delete_reply(aid: str, db: DB, user: Actor):
    a = require(db, Answer, aid)
    q, m = question_access(db, a.question_id, user, lock=True)
    if a.visibility == "private" and m.role != "lecturer":
        raise HTTPException(404, "Reply not available.")
    if m.role != "lecturer" and (a.anonymous or a.author_id != user.id):
        raise HTTPException(403, "Only a named author or lecturer can delete this reply.")
    db.delete(a)
    from .ai.retrieval import enqueue_index

    enqueue_index(db, q.course_id, q.id, "index_question")
    db.commit()
