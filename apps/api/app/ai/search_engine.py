"""Shared course search/preflight: hybrid candidate recall followed by semantic judgment."""

import asyncio
import time
from uuid import uuid4
from sqlalchemy import select, func, literal_column, or_
from ..config import settings
from ..models import SourceChunk, Resource, Question, Lecture, LiveSession, Job
from .providers.openai import OpenAIEmbeddings
from .evidence import judge, cosine, reciprocal_ranks
from .keywords import tokens, stems, keyword_match
from .search_diagnostics import log_search_failure


def lexical_similarity(query, text):
    wanted = set(stems(query))
    return len(wanted & set(stems(text))) / len(wanted) if wanted else 0


def title_for(db, chunk):
    if chunk.resource_id:
        return db.get(Resource, chunk.resource_id).original_filename
    if chunk.session_id:
        return db.get(Lecture, db.get(LiveSession, chunk.session_id).lecture_id).title
    return db.get(Question, chunk.question_id).body_original[:160]


def candidates(db, cid, query, vector, *, resource_only=False):
    from .retrieval import safe_scope

    scope = safe_scope(cid)
    if resource_only:
        scope = scope & SourceChunk.resource_id.is_not(None)
    statement = select(SourceChunk).where(scope)
    if db.bind.dialect.name == "postgresql":
        terms = " OR ".join(tokens(query))
        if terms:
            fts = func.to_tsvector(literal_column("'english'"), SourceChunk.text).op("@@")(
                func.websearch_to_tsquery(literal_column("'english'"), terms)
            )
            simple = func.to_tsvector(literal_column("'simple'"), SourceChunk.text).op("@@")(
                func.websearch_to_tsquery(literal_column("'simple'"), terms)
            )
            lexical = list(db.scalars(statement.where(or_(fts, simple)).limit(160)))
        else:
            lexical = []
    else:
        lexical = list(db.scalars(statement))
    # Current titles and fresh public discussions participate before indexing completes.
    resources = list(
        db.scalars(
            select(Resource).where(
                Resource.course_id == cid, Resource.indexing_enabled.is_(True), Resource.process_status == "ready"
            )
        )
    )
    for resource in resources:
        if keyword_match(query, "", resource.original_filename):
            lexical += list(db.scalars(statement.where(SourceChunk.resource_id == resource.id).limit(80)))
            if not any(chunk.resource_id == resource.id for chunk in lexical):
                lexical.append(
                    SourceChunk(
                        id=resource.id,
                        course_id=cid,
                        resource_id=resource.id,
                        source_type="recording" if resource.kind in {"audio", "video"} else "resource",
                        title=resource.original_filename,
                        text="",
                        chunk_metadata={"transient": True},
                    )
                )
    if not resource_only:
        for question in db.scalars(select(Question).where(Question.course_id == cid, Question.visibility == "public")):
            indexed = db.scalar(select(SourceChunk.id).where(SourceChunk.question_id == question.id).limit(1))
            if not indexed:
                lexical.append(
                    SourceChunk(
                        id=question.id,
                        course_id=cid,
                        question_id=question.id,
                        source_type="question",
                        title=question.body_original[:160],
                        text=question.body_display,
                        chunk_metadata={"transient": True},
                    )
                )
    lexical = sorted(
        {c.id: c for c in lexical}.values(),
        key=lambda c: lexical_similarity(query, c.text + " " + title_for(db, c)),
        reverse=True,
    )[:160]
    semantic = []
    if vector is not None:
        embedded = statement.where(
            SourceChunk.embedding_model == settings().openai_embed_model, SourceChunk.embedding.is_not(None)
        )
        if db.bind.dialect.name == "postgresql":
            semantic = list(db.scalars(embedded.order_by(SourceChunk.embedding.cosine_distance(vector)).limit(160)))
        else:
            semantic = sorted(db.scalars(embedded), key=lambda c: cosine(vector, c.embedding), reverse=True)[:160]
    combined = {c.id: c for c in [*lexical, *semantic]}
    scores = reciprocal_ranks([[c.id for c in lexical], [c.id for c in semantic]])
    return sorted(combined.values(), key=lambda c: scores[c.id], reverse=True)


def index_warnings(db, cid):
    from .retrieval import safe_scope

    resources = list(db.scalars(select(Resource).where(Resource.course_id == cid, Resource.indexing_enabled.is_(True))))
    if any(r.process_status != "ready" or r.extraction_json.get("status") not in {None, "ready"} for r in resources):
        return ["Some course sources are still being prepared. Results may be incomplete."]
    if db.scalar(
        select(SourceChunk.id)
        .where(
            safe_scope(cid),
            or_(
                SourceChunk.embedding.is_(None),
                SourceChunk.embedding_model != settings().openai_embed_model,
                SourceChunk.embedding_model.is_(None),
            ),
        )
        .limit(1)
    ):
        return ["Some course sources are not ready for semantic search. Results may be incomplete."]
    resource_ids = [resource.id for resource in resources]
    question_ids = list(
        db.scalars(select(Question.id).where(Question.course_id == cid, Question.visibility == "public"))
    )
    session_ids = list(db.scalars(select(LiveSession.id).where(LiveSession.course_id == cid)))
    pending_scope = or_(
        (Job.type.in_(["ingest_document", "extract_document", "index_resource"])) & Job.target_id.in_(resource_ids),
        (Job.type == "index_question") & Job.target_id.in_(question_ids),
        (Job.type == "index_session") & Job.target_id.in_(session_ids),
    )
    if db.scalar(
        select(Job.id)
        .where(Job.course_id == cid, pending_scope, Job.status.in_(["queued", "processing", "failed"]))
        .limit(1)
    ):
        return ["Some course sources are still being indexed. Results may be incomplete."]
    missing_question = db.scalar(
        select(Question.id)
        .where(
            Question.course_id == cid,
            Question.visibility == "public",
            ~select(SourceChunk.id).where(SourceChunk.question_id == Question.id).exists(),
        )
        .limit(1)
    )
    return ["New discussions are still being indexed. Results may be incomplete."] if missing_question else []


def authorised(db, cid, chunks):
    from .retrieval import safe_scope

    db.expire_all()
    valid = set(db.scalars(select(SourceChunk.id).where(safe_scope(cid))))
    resources = set(
        db.scalars(
            select(Resource.id).where(
                Resource.course_id == cid, Resource.indexing_enabled.is_(True), Resource.process_status == "ready"
            )
        )
    )
    questions = set(db.scalars(select(Question.id).where(Question.course_id == cid, Question.visibility == "public")))
    return [
        chunk
        for chunk in chunks
        if chunk.id in valid
        or (
            (chunk.chunk_metadata or {}).get("transient")
            and (
                (chunk.id == chunk.question_id and chunk.question_id in questions)
                or (chunk.id == chunk.resource_id and chunk.resource_id in resources)
            )
        )
    ]


def run_search(db, cid, query, deadline, *, mode="preflight"):
    from .retrieval import group_hits, embedding_compatible, _keyword_search

    search_id = uuid4().hex
    started = stage_started = time.monotonic()
    stage = "embedding_configuration"
    candidate_count = 0

    def mark_stage(name):
        nonlocal stage, stage_started
        stage, stage_started = name, time.monotonic()

    def log_failure(exc):
        log_search_failure(
            exc,
            search_id=search_id,
            course_id=cid,
            mode=mode,
            stage=stage,
            started=started,
            stage_started=stage_started,
            deadline=deadline,
            candidates=candidate_count,
        )

    def fallback(message):
        mark_stage("keyword_fallback")
        try:
            matches, _ = _keyword_search(db, cid, query, deadline)
        except Exception as exc:
            log_failure(exc)
            raise
        matches.method = "Keyword fallback"
        matches.complete = False
        return matches, [message]

    if not settings().openai_api_key:
        return fallback(
            "Semantic search is not configured; keyword matches may be incomplete. Review or retry before posting."
        )
    try:
        embedding_compatible(db)
        mark_stage("query_embedding")
        remaining = deadline - time.monotonic()
        timeout = min(settings().query_embedding_timeout_seconds, max(0.01, remaining - 6))

        async def embed_query():
            return await asyncio.wait_for(OpenAIEmbeddings().embed([query], timeout=timeout), timeout=timeout)

        vector = asyncio.run(embed_query())[0]
        mark_stage("index_readiness")
        warnings = index_warnings(db, cid)
        mark_stage("candidate_retrieval")
        chunks = candidates(db, cid, query, vector)
        candidate_count = len(chunks)
        mark_stage("assessment_context")
        entries = [
            {
                "id": c.id,
                "parent": c.resource_id or c.session_id or c.question_id,
                "title": title_for(db, c),
                "text": c.text,
                "kind": "discussion" if c.question_id else "teaching_source",
            }
            for c in chunks
        ]
        snapshots = {c.id: (c.text, title_for(db, c)) for c in chunks}
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Retrieval deadline reached")
        mark_stage("source_assessment")
        decisions, assessment_warnings = asyncio.run(
            judge(
                query,
                entries,
                timeout=remaining,
                purpose="course keyword search" if mode == "keywords" else "question preflight",
            )
        )
        warnings += assessment_warnings
        mark_stage("authorization_recheck")
        chunks = authorised(db, cid, chunks)
        mark_stage("source_grouping")
        current = {c.id: c for c in chunks}
        hits, unlocated = [], set()
        for position, decision in enumerate(decisions):
            chunk = current.get(decision.id)
            if not chunk or decision.relevance != "direct":
                continue
            if snapshots[chunk.id] != (chunk.text, title_for(db, chunk)):
                warnings.append("A source changed during search. Retry to check its current content.")
                continue
            hits.append((chunk, (1 if decision.relevance == "direct" else 0.7) - position * 0.001))
            if not decision.passage_supported:
                unlocated.add(chunk.id)
        matches = group_hits(db, hits, unlocated)
        matches.method = "Semantic course source search"
        matches.complete = not warnings
        return matches, list(dict.fromkeys(warnings))
    except Exception as exc:
        log_failure(exc)
        if time.monotonic() >= deadline:
            raise
        return fallback(
            "Semantic source assessment is unavailable; keyword matches may be incomplete. Retry or review before posting."
        )
