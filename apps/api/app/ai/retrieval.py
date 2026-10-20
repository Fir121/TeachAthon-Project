import asyncio
import json
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, delete, and_, or_, func, literal_column
from ..config import settings
from ..models import (
    SourceChunk,
    EmbeddingConfig,
    Resource,
    Transcript,
    Lecture,
    LiveSession,
    Question,
    Answer,
    Course,
    Job,
)
from .providers.openai import OpenAIEmbeddings, OpenAIText


def embedding_compatible(db):
    config = db.get(EmbeddingConfig, "active")
    if config and (
        config.model != settings().openai_embed_model or config.dimensions != settings().openai_embed_dimensions
    ):
        raise RuntimeError(
            "Embedding model/dimensions differ from the database schema. Migrate and reindex explicitly before changing them."
        )


def safe_scope(cid):
    # Evaluate current source authorization/exclusion at query time, including while cleanup is pending.
    resource_ok = (
        select(Resource.id)
        .where(
            Resource.id == SourceChunk.resource_id,
            Resource.course_id == cid,
            Resource.indexing_enabled.is_(True),
            Resource.process_status == "ready",
        )
        .exists()
    )
    session_ok = (
        select(LiveSession.id).where(LiveSession.id == SourceChunk.session_id, LiveSession.course_id == cid).exists()
    )
    question_ok = (
        select(Question.id)
        .where(
            Question.id == SourceChunk.question_id,
            Question.course_id == cid,
            Question.visibility == "public",
            Question.state != "dismissed",
        )
        .exists()
    )
    answer_ok = select(Answer.id).where(Answer.id == SourceChunk.answer_id, Answer.visibility == "public").exists()
    return and_(
        SourceChunk.course_id == cid,
        or_(
            and_(SourceChunk.resource_id.is_not(None), resource_ok),
            and_(SourceChunk.session_id.is_not(None), session_ok),
            and_(SourceChunk.question_id.is_not(None), question_ok),
        ),
        or_(SourceChunk.question_id.is_(None), question_ok),
        or_(SourceChunk.answer_id.is_(None), answer_ok),
    )


def enqueue_index(db, cid, target, kind="index_resource"):
    if not db.scalar(select(Job.id).where(Job.type == kind, Job.target_id == target, Job.status == "queued").limit(1)):
        db.add(Job(type=kind, course_id=cid, target_id=target))


async def embed_chunks(db, chunks):
    if not settings().openai_api_key:
        return
    embedding_compatible(db)
    provider = OpenAIEmbeddings()
    for i in range(0, len(chunks), 32):
        batch = chunks[i : i + 32]
        vectors = await provider.embed([c.text for c in batch])
        for c, v in zip(batch, vectors):
            c.embedding = v
            c.embedding_model = settings().openai_embed_model
        db.commit()


def index_resource(db, job):
    r = db.get(Resource, job.target_id)
    if not r:
        return
    db.execute(delete(SourceChunk).where(SourceChunk.resource_id == r.id))
    chunks = []
    if r.indexing_enabled and r.process_status == "ready":
        for i, page in enumerate(r.pages):
            text = page.get("text", "").strip()
            for j in range(0, len(text), 1800):
                chunks.append(
                    SourceChunk(
                        course_id=r.course_id,
                        resource_id=r.id,
                        source_type="recording" if r.kind in {"audio", "video"} else "resource",
                        title=r.original_filename,
                        text=text[j : j + 2200],
                        page_number=i + 1 if r.kind not in {"audio", "video"} else None,
                        start_ms=page.get("start_ms"),
                        end_ms=page.get("end_ms"),
                    )
                )
    db.add_all(chunks)
    db.commit()
    asyncio.run(embed_chunks(db, chunks))


def index_session(db, job):
    s = db.get(LiveSession, job.target_id)
    if not s:
        return
    lecture = db.get(Lecture, s.lecture_id)
    existing = list(db.scalars(select(SourceChunk).where(SourceChunk.session_id == s.id)))
    known = {(c.start_ms, c.end_ms, c.text) for c in existing}
    chunks = []
    for t in db.scalars(select(Transcript).where(Transcript.session_id == s.id)):
        if t.text.strip() and (t.start_ms, t.end_ms, t.text) not in known:
            chunks.append(
                SourceChunk(
                    course_id=s.course_id,
                    session_id=s.id,
                    source_type="lecture_explanation",
                    title=lecture.title,
                    text=t.text[:8000],
                    start_ms=t.start_ms,
                    end_ms=t.end_ms,
                )
            )
    db.add_all(chunks)
    db.commit()
    asyncio.run(embed_chunks(db, [*chunks, *[c for c in existing if c.embedding is None]]))


def index_question(db, job):
    q = db.get(Question, job.target_id)
    db.execute(delete(SourceChunk).where(SourceChunk.question_id == job.target_id))
    chunks = []
    if q and q.visibility == "public" and q.state != "dismissed":
        chunks.append(
            SourceChunk(
                course_id=q.course_id,
                question_id=q.id,
                source_type="question",
                title="Public course question",
                text=q.body_display,
            )
        )
        for a in db.scalars(select(Answer).where(Answer.question_id == q.id, Answer.visibility == "public")):
            chunks.append(
                SourceChunk(
                    course_id=q.course_id,
                    question_id=q.id,
                    answer_id=a.id,
                    source_type="lecturer_answer" if a.lecturer_authored else "forum_reply",
                    title="Lecturer written answer" if a.lecturer_authored else "Public discussion reply",
                    text=a.body,
                )
            )
    db.add_all(chunks)
    db.commit()
    asyncio.run(embed_chunks(db, chunks))


def citation(chunk, score):
    if chunk.session_id:
        url = f"/recordings/{chunk.session_id}?t={chunk.start_ms or 0}"
        category = "relevant_lecture_explanation"
    elif chunk.resource_id:
        url = f"/api/v1/resources/{chunk.resource_id}/download"
        if chunk.start_ms is not None:
            url = f"/resources/{chunk.resource_id}?t={chunk.start_ms}"
        category = "relevant_material"
    else:
        url = f"/courses/{chunk.course_id}/discussions?question={chunk.question_id}"
        category = (
            "existing_lecturer_answer"
            if chunk.source_type == "lecturer_answer"
            else "relevant_public_discussion"
            if chunk.answer_id
            else "similar_public_question"
        )
    return {
        "source_id": chunk.id,
        "question_id": chunk.question_id,
        "source_type": chunk.source_type,
        "title": chunk.title,
        "excerpt": chunk.text[:1000],
        "page_number": chunk.page_number,
        "start_ms": chunk.start_ms,
        "end_ms": chunk.end_ms,
        "url": url,
        "category": category,
        "score": round(score, 4),
    }


async def search(db, cid, query):
    from ..questions import lexical_score, words

    scope = safe_scope(cid)
    candidates = {}
    fts = {}
    semantic = {}
    warnings = []
    if db.bind.dialect.name == "postgresql":
        rank = func.ts_rank_cd(
            func.to_tsvector(literal_column("'english'"), SourceChunk.text),
            func.websearch_to_tsquery(literal_column("'english'"), query),
        )
        for chunk, score in db.execute(
            select(SourceChunk, rank.label("rank")).where(scope, rank > 0).order_by(rank.desc()).limit(50)
        ):
            candidates[chunk.id] = chunk
            fts[chunk.id] = float(score)
    else:
        for c in db.scalars(select(SourceChunk).where(scope).limit(1000)):
            candidates[c.id] = c
    if settings().openai_api_key:
        try:
            embedding_compatible(db)
            vector = (await asyncio.wait_for(OpenAIEmbeddings().embed([query[:8000]]), timeout=3))[0]
            if db.bind.dialect.name == "postgresql":
                distance = SourceChunk.embedding.cosine_distance(vector)
                for c, d in db.execute(
                    select(SourceChunk, distance)
                    .where(
                        scope,
                        SourceChunk.embedding_model == settings().openai_embed_model,
                        SourceChunk.embedding.is_not(None),
                    )
                    .order_by(distance)
                    .limit(30)
                ):
                    candidates[c.id] = c
                    semantic[c.id] = 1 - float(d)
        except Exception as exc:
            warnings.append(
                str(exc)
                if isinstance(exc, RuntimeError)
                else "Semantic search is unavailable; keyword results are shown."
            )
    results = []
    for c in candidates.values():
        lexical = lexical_score(query, c.text)
        overlap = len(words(query) & words(c.text))
        sim = semantic.get(c.id, 0)
        if not ((lexical >= 0.45 and overlap >= 2) or sim >= 0.78):
            continue
        score = 0.6 * lexical + 0.35 * max(0, sim) + 0.05 * min(1, fts.get(c.id, 0))
        item = citation(c, score)
        if c.session_id:
            session = db.get(LiveSession, c.session_id)
            item["audio_available"] = session.recording_state == "ready"
            if not item["audio_available"]:
                item["category"] = "relevant_lecture_transcript"
        results.append(item)
    # Public current questions are checked even before their indexing job completes.
    indexed_questions = {c.question_id for c in candidates.values() if c.question_id}
    for q in db.scalars(
        select(Question)
        .where(Question.course_id == cid, Question.visibility == "public", Question.state != "dismissed")
        .limit(500)
    ):
        score = lexical_score(query, q.body_display)
        if q.id not in indexed_questions and score >= 0.6 and len(words(query) & words(q.body_display)) >= 2:
            results.append(
                {
                    "source_id": q.id,
                    "question_id": q.id,
                    "source_type": "question",
                    "title": "Existing public question",
                    "excerpt": q.body_display[:700],
                    "category": "similar_public_question",
                    "score": score * 0.6,
                    "url": f"/courses/{cid}/discussions?question={q.id}",
                }
            )
    return sorted(results, key=lambda r: r["score"], reverse=True)[:8], warnings


class GroundedAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str
    source_ids: list[str]


async def optional_answer(db, cid, query, matches):
    if not db.get(Course, cid).settings_json.get("generated_answers") or not matches:
        return None
    data = await asyncio.wait_for(
        OpenAIText().structured(
            f"Answer briefly only using these course sources. If insufficient return an empty answer. Cite source IDs. Question: {query}\nSources: {json.dumps(matches)}",
            GroundedAnswer,
        ),
        timeout=3,
    )
    allowed = {m["source_id"] for m in matches}
    if not data.source_ids or not set(data.source_ids) <= allowed:
        return None
    return data.answer[:1500]
