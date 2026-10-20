import asyncio
import json
from contextlib import contextmanager
from typing import Literal
from concurrent.futures import ThreadPoolExecutor
import time
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

# Shared bounded executor survives each synchronous route's short async orchestration loop.
# Cancelling a deadline never waits for asyncio.run() to join a blocked default executor.
_retrieval_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="course-retrieval")


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
    answer_ok = (
        select(Answer.id)
        .where(
            Answer.id == SourceChunk.answer_id,
            Answer.question_id == SourceChunk.question_id,
            Answer.visibility == "public",
        )
        .exists()
    )
    return and_(
        SourceChunk.course_id == cid,
        or_(
            and_(SourceChunk.resource_id.is_not(None), resource_ok),
            and_(SourceChunk.session_id.is_not(None), session_ok),
            and_(SourceChunk.question_id.is_not(None), question_ok),
        ),
        or_(SourceChunk.resource_id.is_(None), resource_ok),
        or_(SourceChunk.session_id.is_(None), session_ok),
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


def resource_chunks(resource, pages):
    from .chunking import split_text

    chunks = []
    if not resource.indexing_enabled:
        return chunks
    physical = resource.kind in {"pdf", "pptx", "docx"}
    for i, page in enumerate(pages):
        for part in split_text(page.get("text", "")):
            chunks.append(
                SourceChunk(
                    course_id=resource.course_id,
                    resource_id=resource.id,
                    source_type="recording" if resource.kind in {"audio", "video"} else "resource",
                    title=resource.original_filename,
                    text=part["text"],
                    page_number=(page.get("page_number") or i + 1) if physical else None,
                    start_ms=page.get("start_ms"),
                    end_ms=page.get("end_ms"),
                    chunk_metadata={k: v for k, v in part.items() if k != "text"}
                    | {
                        "source_section": i,
                        "extraction_version": page.get("extraction_version", "utf8-or-transcript-v1"),
                    },
                )
            )
    return chunks


def replace_resource_index(db, resource, pages):
    chunks = resource_chunks(resource, pages)  # Build fully before touching the old index.
    db.execute(delete(SourceChunk).where(SourceChunk.resource_id == resource.id))
    db.add_all(chunks)
    return chunks


def index_resource(db, job):
    from .chunking import CHUNK_VERSION

    resource = db.get(Resource, job.target_id)
    if not resource or resource.process_status != "ready":
        return
    chunks = list(db.scalars(select(SourceChunk).where(SourceChunk.resource_id == resource.id)))
    if not chunks or any(c.chunk_metadata.get("version") != CHUNK_VERSION for c in chunks):
        chunks = replace_resource_index(db, resource, resource.pages)
    if not resource.indexing_enabled:
        db.execute(delete(SourceChunk).where(SourceChunk.resource_id == resource.id))
        chunks = []
    resource.extraction_json = {**resource.extraction_json, "chunk_version": CHUNK_VERSION}
    db.commit()
    asyncio.run(embed_chunks(db, [c for c in chunks if c.embedding is None]))


def index_session(db, job):
    from .chunking import split_text

    session = db.get(LiveSession, job.target_id)
    if not session:
        return
    lecture = db.get(Lecture, session.lecture_id)
    existing = list(db.scalars(select(SourceChunk).where(SourceChunk.session_id == session.id)))
    # Reuse valid vectors during incremental caption indexing, while replacing older chunk versions.
    by_source = {(c.chunk_metadata.get("transcript_id"), c.chunk_metadata.get("start_char")): c for c in existing}
    chunks = []
    kept_ids = set()
    for transcript in db.scalars(select(Transcript).where(Transcript.session_id == session.id)):
        for part in split_text(transcript.text):
            key = (transcript.id, part["start_char"])
            old = by_source.pop(key, None)
            if old and old.text == part["text"] and old.chunk_metadata.get("version") == part["version"]:
                kept_ids.add(old.id)
                chunks.append(old)
                continue
            if old:
                db.delete(old)
            chunks.append(
                SourceChunk(
                    course_id=session.course_id,
                    session_id=session.id,
                    source_type="lecture_explanation",
                    title=lecture.title,
                    text=part["text"],
                    start_ms=transcript.start_ms,
                    end_ms=transcript.end_ms,
                    chunk_metadata={k: v for k, v in part.items() if k != "text"}
                    | {"transcript_id": transcript.id, "timing": transcript.timing},
                )
            )
    for stale in existing:
        if stale.id not in kept_ids and stale not in db.deleted:
            db.delete(stale)
    db.add_all(chunks)
    db.commit()
    asyncio.run(embed_chunks(db, [c for c in chunks if c.embedding is None]))


def index_question(db, job):
    from .chunking import split_text

    question = db.get(Question, job.target_id)
    chunks = []
    if question and question.visibility == "public" and question.state != "dismissed":
        sources = [(question.body_display, None)]
        sources += [
            (a.body, a)
            for a in db.scalars(select(Answer).where(Answer.question_id == question.id, Answer.visibility == "public"))
        ]
        for text, answer in sources:
            for part in split_text(text):
                chunks.append(
                    SourceChunk(
                        course_id=question.course_id,
                        question_id=question.id,
                        answer_id=answer.id if answer else None,
                        source_type=("lecturer_answer" if answer.lecturer_authored else "forum_reply")
                        if answer
                        else "question",
                        title=question.body_original[:160],
                        text=part["text"],
                        chunk_metadata={k: v for k, v in part.items() if k != "text"},
                    )
                )
    db.execute(delete(SourceChunk).where(SourceChunk.question_id == job.target_id))
    db.add_all(chunks)
    db.commit()
    asyncio.run(embed_chunks(db, chunks))


class SourceLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page_number: int | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    url: str


class SourceGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str  # Stable parent ID, never a chunk ID.
    source_type: Literal["document", "recording", "discussion"]
    title: str
    url: str
    locations: list[SourceLocation]
    question_id: str | None = None
    audio_available: bool | None = None
    score: float


class SearchResponse(BaseModel):
    matches: list[SourceGroup]
    warnings: list[str]


class PreflightResponse(BaseModel):
    preflight_token: str
    status: str
    error: str | None
    matches: list[SourceGroup]
    method: str
    generated_answer: str | None


class SearchMatches(list):
    """Only list contents serialize; internal contexts never enter the public response."""

    def __init__(self, groups, contexts):
        super().__init__(groups)
        self.contexts = contexts


def group_hits(db, hits, unlocated=None):
    unlocated = unlocated or set()
    groups = {}
    contexts = {}
    for chunk, score in sorted(hits, key=lambda item: item[1], reverse=True):
        parent = chunk.resource_id or chunk.session_id or chunk.question_id
        kind = (
            "document"
            if chunk.resource_id and chunk.source_type != "recording"
            else "recording"
            if chunk.resource_id or chunk.session_id
            else "discussion"
        )
        key = (kind, parent)
        if key not in groups:
            if chunk.resource_id:
                source = db.get(Resource, chunk.resource_id)
                title, url, available = source.original_filename, f"/resources/{parent}", None
            elif chunk.session_id:
                session = db.get(LiveSession, chunk.session_id)
                title, url, available = (
                    db.get(Lecture, session.lecture_id).title,
                    f"/recordings/{parent}",
                    session.recording_state == "ready",
                )
            else:
                question = db.get(Question, chunk.question_id)
                title, url, available = (
                    question.body_original[:160],
                    f"/courses/{chunk.course_id}/discussions?question={parent}",
                    None,
                )
            groups[key] = {
                "source_id": parent,
                "source_type": kind,
                "title": title,
                "url": url,
                "question_id": chunk.question_id if kind == "discussion" else None,
                "audio_available": available,
                "score": round(score, 4),
                "locations": [],
            }
            contexts[key] = []
        group = groups[key]
        page = chunk.page_number if kind == "document" and chunk.id not in unlocated else None
        # Old TXT/JSON chunks may carry fabricated page numbers until their backfill runs.
        if chunk.resource_id and db.get(Resource, chunk.resource_id).kind not in {"pdf", "pptx", "docx"}:
            page = None
        start = chunk.start_ms if kind == "recording" and chunk.id not in unlocated else None
        url = group["url"] + (f"?page={page}" if page is not None else f"?t={start}" if start is not None else "")
        location = {
            "page_number": page,
            "start_ms": start,
            "end_ms": chunk.end_ms if start is not None else None,
            "url": url,
        }
        # Deduplicate physical page / start offset, even when multiple chunks overlap.
        if (page is not None or start is not None) and not any(
            l["page_number"] == page and l["start_ms"] == start for l in group["locations"]
        ):
            group["locations"].append(location)
        contexts[key].append({"source_id": parent, "text": chunk.text, "url": url})
    keys = list(groups)[:8]  # Limit AFTER grouping by best qualifying hit.
    for key in keys:
        groups[key]["locations"].sort(key=lambda location: (location["page_number"] or 0, location["start_ms"] or 0))
        if groups[key]["locations"]:
            groups[key]["url"] = groups[key]["locations"][0]["url"]
    return SearchMatches([groups[k] for k in keys], [context for k in keys for context in contexts[k]][:40])


async def search(db, cid, query, mode="preflight"):
    # A separate session belongs to the worker thread. No synchronous SQL on the live event loop.
    budget = settings().retrieval_timeout_seconds
    future = asyncio.get_running_loop().run_in_executor(
        _retrieval_pool, _search, db.get_bind(), cid, query, budget, time.monotonic(), mode
    )
    return await asyncio.wait_for(future, timeout=budget)


@contextmanager
def deadline_session(bind, budget):
    import time
    from sqlalchemy.orm import Session
    from sqlalchemy import event

    deadline = time.monotonic() + budget
    with Session(bind, expire_on_commit=False) as db:
        connection = db.connection()

        def bound_query(conn, cursor, statement, parameters, context, executemany):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Retrieval deadline reached")
            if bind.dialect.name == "postgresql":
                cursor.execute(f"SET LOCAL statement_timeout = {max(1, int(remaining * 1000))}")

        event.listen(connection, "before_cursor_execute", bound_query)
        try:
            yield db, deadline
        finally:
            event.remove(connection, "before_cursor_execute", bound_query)


def _search(bind, cid, query, budget, requested_at=None, mode="preflight"):
    budget -= time.monotonic() - requested_at if requested_at is not None else 0
    with deadline_session(bind, budget) as (db, deadline):
        return _keyword_search(db, cid, query, deadline) if mode == "keywords" else _retrieve(db, cid, query, deadline)


def _keyword_search(db, cid, query, deadline):
    from .keywords import keyword_match, tokens

    if not tokens(query):
        return SearchMatches([], []), []
    scope = safe_scope(cid)
    # Current parent titles participate, rather than stale titles saved in old chunks.
    resources = {r.id: r for r in db.scalars(select(Resource).where(Resource.course_id == cid))}
    sessions = {s.id: s for s in db.scalars(select(LiveSession).where(LiveSession.course_id == cid))}
    lectures = {l.id: l.title for l in db.scalars(select(Lecture).where(Lecture.course_id == cid))}
    questions = {
        q.id: q
        for q in db.scalars(
            select(Question).where(
                Question.course_id == cid, Question.visibility == "public", Question.state != "dismissed"
            )
        )
    }
    hits, unlocated, indexed = [], set(), set()
    statement = select(SourceChunk).where(scope)
    if db.bind.dialect.name == "postgresql":
        body_match = func.to_tsvector(literal_column("'english'"), SourceChunk.text).op("@@")(
            func.websearch_to_tsquery(literal_column("'english'"), " OR ".join(tokens(query)))
        )
        title_match = or_(
            SourceChunk.resource_id.in_(
                [rid for rid, resource in resources.items() if keyword_match(query, "", resource.original_filename)]
            ),
            SourceChunk.session_id.in_(
                [sid for sid, session in sessions.items() if keyword_match(query, "", lectures[session.lecture_id])]
            ),
            SourceChunk.question_id.in_(
                [qid for qid, question in questions.items() if keyword_match(query, "", question.body_original)]
            ),
        )
        statement = statement.where(or_(body_match, title_match))
    # Candidate collection uses FTS; qualification and the eight-result cap follow grouping.
    for chunk in db.scalars(statement):
        if time.monotonic() >= deadline:
            raise TimeoutError("Keyword search deadline reached")
        if chunk.resource_id:
            title = resources[chunk.resource_id].original_filename
        elif chunk.session_id:
            title = lectures[sessions[chunk.session_id].lecture_id]
        else:
            title = questions[chunk.question_id].body_original
            indexed.add(chunk.question_id)
        match = keyword_match(query, chunk.text, title)
        if match:
            score, located = match
            hits.append((chunk, score))
            if not located:
                unlocated.add(chunk.id)
    for question in questions.values():
        if question.id in indexed:
            continue
        match = keyword_match(query, question.body_display, question.body_original)
        if match:
            hits.append(
                (
                    SourceChunk(
                        id=question.id,
                        course_id=cid,
                        question_id=question.id,
                        source_type="question",
                        title=question.body_original[:160],
                        text=question.body_display,
                    ),
                    match[0],
                )
            )
    # Recheck current visibility/exclusions, including changes while scanning large courses.
    allowed = set(db.scalars(select(SourceChunk.id).where(scope)))
    public_questions = set(
        db.scalars(
            select(Question.id).where(
                Question.course_id == cid, Question.visibility == "public", Question.state != "dismissed"
            )
        )
    )
    hits = [
        (chunk, score)
        for chunk, score in hits
        if chunk.id in allowed or (chunk.id == chunk.question_id and chunk.question_id in public_questions)
    ]
    return group_hits(db, hits, unlocated), []


def _retrieve(db, cid, query, deadline):
    import time
    from ..questions import lexical_score, words

    scope = safe_scope(cid)
    candidates, fts, semantic, warnings = {}, {}, {}, []
    if db.bind.dialect.name == "postgresql":
        rank = func.ts_rank_cd(
            func.to_tsvector(literal_column("'english'"), SourceChunk.text),
            func.websearch_to_tsquery(literal_column("'english'"), query),
        )
        # Candidate collection must allow partial lexical overlap: natural questions and
        # OCR punctuation can fail an all-terms websearch even when the relevance gate passes.
        terms = " | ".join(sorted(words(query)))
        vector_text = func.to_tsvector(literal_column("'english'"), SourceChunk.text)
        keyword_match = vector_text.op("@@")(func.to_tsquery(literal_column("'english'"), terms)) if terms else rank > 0
        # No chunk cap before source grouping; retain the original full-text ranking term.
        for chunk, score in db.execute(
            select(SourceChunk, rank.label("rank")).where(scope, keyword_match).order_by(rank.desc())
        ):
            candidates[chunk.id], fts[chunk.id] = chunk, float(score)
    else:
        for chunk in db.scalars(select(SourceChunk).where(scope)):
            candidates[chunk.id] = chunk
    if settings().openai_api_key:
        try:
            embedding_compatible(db)
            timeout = min(settings().query_embedding_timeout_seconds, max(0.01, deadline - time.monotonic()))

            async def query_vector():
                return await asyncio.wait_for(
                    OpenAIEmbeddings().embed([query[:8000]], timeout=timeout), timeout=timeout
                )

            vector = asyncio.run(query_vector())[0]
            if db.bind.dialect.name == "postgresql":
                distance = SourceChunk.embedding.cosine_distance(vector)
                # Threshold before grouping; no chunk-based result cap.
                for chunk, value in db.execute(
                    select(SourceChunk, distance)
                    .where(
                        scope,
                        SourceChunk.embedding_model == settings().openai_embed_model,
                        SourceChunk.embedding.is_not(None),
                        distance <= 0.22,
                    )
                    .order_by(distance)
                ):
                    candidates[chunk.id], semantic[chunk.id] = chunk, 1 - float(value)
        except Exception:
            warnings.append("Semantic search is unavailable; keyword results are shown.")
    # Recheck current authorization after provider latency, including exclusions/private edits.
    permitted = set(db.scalars(select(SourceChunk.id).where(scope)))
    hits = []
    for chunk in candidates.values():
        if time.monotonic() >= deadline:
            raise TimeoutError("Retrieval deadline reached")
        if chunk.id not in permitted:
            continue
        lexical, overlap = lexical_score(query, chunk.text), len(words(query) & words(chunk.text))
        sim = semantic.get(chunk.id, 0)
        if (lexical >= 0.45 and overlap >= 2) or sim >= 0.78:
            score = 0.6 * lexical + 0.35 * max(0, sim) + 0.05 * min(1, fts.get(chunk.id, 0))
            hits.append((chunk, score))
    indexed_questions = {c.question_id for c in candidates.values() if c.question_id}
    for question in db.scalars(
        select(Question).where(
            Question.course_id == cid, Question.visibility == "public", Question.state != "dismissed"
        )
    ):
        score = lexical_score(query, question.body_display)
        if (
            question.id not in indexed_questions
            and score >= 0.6
            and len(words(query) & words(question.body_display)) >= 2
        ):
            hits.append(
                (
                    SourceChunk(
                        id=question.id,
                        course_id=cid,
                        question_id=question.id,
                        source_type="question",
                        title=question.body_original[:160],
                        text=question.body_display,
                    ),
                    score * 0.6,
                )
            )
    return group_hits(db, hits), warnings


class GroundedAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str
    source_ids: list[str]


async def optional_answer(db, cid, query, matches):
    budget = settings().answer_timeout_seconds
    future = asyncio.get_running_loop().run_in_executor(
        _retrieval_pool, _answer, db.get_bind(), cid, query, matches, budget, time.monotonic()
    )
    return await asyncio.wait_for(future, timeout=budget)


def _answer(bind, cid, query, matches, budget, requested_at=None):
    budget -= time.monotonic() - requested_at if requested_at is not None else 0
    with deadline_session(bind, budget) as (db, deadline):
        if not db.get(Course, cid).settings_json.get("generated_answers") or not matches:
            return None
    budget = max(0.01, deadline - time.monotonic())
    contexts = getattr(matches, "contexts", [])
    if not contexts:
        return None

    async def generate():
        return await asyncio.wait_for(
            OpenAIText().structured(
                f"Answer briefly only using these course sources. If insufficient return an empty answer. Cite source IDs. Question: {query}\nSources: {json.dumps(contexts)}",
                GroundedAnswer,
                timeout=budget,
            ),
            timeout=budget,
        )

    data = asyncio.run(generate())
    allowed = {m["source_id"] for m in matches}
    if not data.source_ids or not set(data.source_ids) <= allowed:
        return None
    return data.answer[:1500]
