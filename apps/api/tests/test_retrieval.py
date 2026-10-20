import asyncio
import pytest
from sqlalchemy import select
from app.models import SourceChunk, Resource, Question, Answer, EmbeddingConfig
from app.ai.retrieval import search, embedding_compatible, index_resource
from app.models import Job
from test_classroom import room, post_question


def test_retrieval_filters_private_disabled_crosscourse_and_irrelevant(room):
    t, s, o, factory, cid, lid, sid, _ = room
    private = post_question(s, cid, sid, "Binary search private medical concern", True, "private")
    public = post_question(s, cid, sid, "Why does binary search use a sorted sequence?")
    with factory() as db:
        resource = db.scalar(select(Resource).where(Resource.course_id == cid))
        db.add_all(
            [
                SourceChunk(
                    course_id=cid,
                    resource_id=resource.id,
                    source_type="resource",
                    title="Search notes",
                    text="Binary search requires a sorted sequence. Each comparison halves the interval.",
                    page_number=1,
                ),
                SourceChunk(
                    course_id=cid,
                    question_id=private["id"],
                    source_type="question",
                    title="PRIVATE",
                    text="Binary search private medical concern",
                ),
                SourceChunk(
                    course_id=cid,
                    question_id=private["id"],
                    session_id=sid,
                    source_type="lecture_explanation",
                    title="PRIVATE WITH SESSION",
                    text="Binary search private medical concern",
                ),
                SourceChunk(
                    course_id=cid,
                    session_id=sid,
                    source_type="lecture_explanation",
                    title="Human explanation",
                    text="Binary search works on sorted data by halving the search interval.",
                    start_ms=1000,
                    end_ms=6000,
                ),
            ]
        )
        db.commit()
    result = s.get(f"/api/v1/courses/{cid}/search", params={"q": "binary search sorted interval"}).json()
    assert any(m["source_type"] == "recording" and m["locations"][0]["start_ms"] == 1000 for m in result["matches"])
    document = next(m for m in result["matches"] if m["source_type"] == "document")
    assert document["url"].startswith("/resources/") and document["url"].endswith("?page=1")
    assert document["locations"][0]["start_ms"] is None
    assert all("excerpt" not in m and "text" not in m for m in result["matches"])
    assert all("PRIVATE" not in m["title"] for m in result["matches"])
    assert (
        s.get(f"/api/v1/courses/{cid}/search", params={"q": "photosynthesis chloroplast sunlight"}).json()["matches"]
        == []
    )
    assert o.get(f"/api/v1/courses/{cid}/search", params={"q": "binary search"}).status_code == 404
    with factory() as db:
        resource = db.scalar(select(Resource).where(Resource.course_id == cid))
        resource.indexing_enabled = False
        db.commit()
    result = s.get(f"/api/v1/courses/{cid}/search", params={"q": "binary search sorted interval"}).json()
    assert all(m["source_type"] != "document" for m in result["matches"])


def test_preflight_failure_proof_still_posts(room, monkeypatch):
    t, s, o, factory, cid, lid, sid, _ = room
    import app.ai.retrieval

    async def unavailable(*_):
        raise TimeoutError()

    monkeypatch.setattr(app.ai.retrieval, "search", unavailable)
    data = {
        "text": "Why does the search interval shrink?",
        "anonymous": True,
        "visibility": "public",
        "session_id": sid,
    }
    r = s.post(f"/api/v1/courses/{cid}/questions/preflight", json=data)
    assert r.json()["status"] == "failed"
    posted = s.post(f"/api/v1/courses/{cid}/questions", json={**data, "preflight_token": r.json()["preflight_token"]})
    assert posted.status_code == 201 and posted.json()["author_id"] is None


def test_embedding_model_dimension_guard(room):
    t, s, o, factory, cid, lid, sid, student = room
    with factory() as db:
        db.add(EmbeddingConfig(id="active", model="incompatible-model", dimensions=9))
        db.commit()
        with pytest.raises(RuntimeError, match="differ"):
            embedding_compatible(db)


def test_groups_all_pages_and_replies_before_eight_result_limit(room):
    from app.models import Course, uid

    t, s, _, factory, cid, _, sid, student = room
    question = post_question(s, cid, sid, "Binary search original thread opening?")
    with factory() as db:
        resource = db.scalar(select(Resource).where(Resource.course_id == cid))
        # Repeated chunk hits across many pages must not consume the eight-parent limit.
        for page in range(1, 12):
            for _ in range(3):
                db.add(
                    SourceChunk(
                        course_id=cid,
                        resource_id=resource.id,
                        source_type="resource",
                        title="internal",
                        text="Binary search sorted interval",
                        page_number=page,
                    )
                )
        reply = Answer(
            question_id=question["id"],
            author_id=student["id"],
            body="Binary search sorted interval",
            visibility="public",
            lecturer_authored=False,
        )
        private_reply = Answer(
            question_id=question["id"],
            author_id=student["id"],
            body="Binary search sorted interval",
            visibility="private",
            lecturer_authored=False,
        )
        db.add_all([reply, private_reply])
        db.flush()
        for answer in [reply, private_reply]:
            db.add(
                SourceChunk(
                    course_id=cid,
                    question_id=question["id"],
                    answer_id=answer.id,
                    source_type="forum_reply",
                    title="INTERNAL REPLY TITLE",
                    text=answer.body,
                )
            )
        # A private reply must not add a recording time to another otherwise-public source.
        db.add(
            SourceChunk(
                course_id=cid,
                question_id=question["id"],
                answer_id=private_reply.id,
                session_id=sid,
                source_type="lecture_explanation",
                title="private locator",
                text=private_reply.body,
                start_ms=999999,
                end_ms=1000000,
            )
        )
        for number in range(10):
            r = Resource(
                course_id=cid,
                original_filename=f"notes-{number}.txt",
                storage_key=f"notes-{number}",
                content_type="text/plain",
                size_bytes=10,
                sha256="fixture",
                kind="txt",
                process_status="ready",
                pages=[],
            )
            db.add(r)
            db.flush()
            db.add(
                SourceChunk(
                    course_id=cid,
                    resource_id=r.id,
                    source_type="resource",
                    title="internal",
                    text="Binary search sorted interval",
                    page_number=7,
                )
            )
        other = Course(name="Other course")
        db.add(other)
        db.flush()
        foreign = Resource(
            course_id=other.id,
            original_filename="CROSS COURSE",
            storage_key="foreign",
            content_type="text/plain",
            size_bytes=1,
            sha256="fixture",
            kind="txt",
            process_status="ready",
            pages=[],
        )
        db.add(foreign)
        db.flush()
        db.add(
            SourceChunk(
                course_id=cid,
                resource_id=foreign.id,
                session_id=sid,
                source_type="resource",
                title="foreign",
                text="Binary search sorted interval",
                page_number=90,
            )
        )
        db.commit()
    result = s.get(f"/api/v1/courses/{cid}/search", params={"q": "binary search sorted interval"}).json()["matches"]
    assert len(result) == 8
    doc = next(m for m in result if m["source_id"] == resource.id)
    assert [location["page_number"] for location in doc["locations"]] == list(range(1, 12))
    thread = next(m for m in result if m["source_type"] == "discussion")
    assert thread["title"] == question["text"] and thread["locations"] == []
    assert sum(m["source_id"] == question["id"] for m in result) == 1
    assert all("excerpt" not in m and "text" not in m for m in result)
    assert all(m["locations"] == [] for m in result if m["title"].endswith(".txt"))
    assert all(m["title"] != "CROSS COURSE" for m in result)
    assert all(l["start_ms"] != 999999 and l["page_number"] != 90 for m in result for l in m["locations"])
    # Deleted/private discussions cannot influence any result, even while old chunks remain.
    with factory() as db:
        q = db.get(Question, question["id"])
        q.visibility = "private"
        db.commit()
    result = s.get(f"/api/v1/courses/{cid}/search", params={"q": "binary search sorted interval"}).json()["matches"]
    assert all(m["source_id"] != question["id"] for m in result)


def test_embedding_deadline_keyword_fallback_and_failure_proof(room, monkeypatch):
    import time
    from app.config import settings
    from app.ai.retrieval import OpenAIEmbeddings

    t, s, _, factory, cid, _, sid, _ = room
    with factory() as db:
        r = db.scalar(select(Resource).where(Resource.course_id == cid))
        db.add(
            SourceChunk(
                course_id=cid,
                resource_id=r.id,
                source_type="resource",
                title="notes",
                text="Binary search sorted interval",
                page_number=1,
            )
        )
        db.commit()

    async def slow(self, texts, **kwargs):
        await asyncio.sleep(2)
        raise AssertionError("Must be cancelled before reaching here")

    monkeypatch.setattr(settings(), "openai_api_key", "test-only-not-a-real-key")
    monkeypatch.setattr(settings(), "query_embedding_timeout_seconds", 0.05)
    monkeypatch.setattr(OpenAIEmbeddings, "embed", slow)
    started = time.monotonic()
    data = {"text": "Binary search sorted interval", "session_id": sid}
    response = s.post(f"/api/v1/courses/{cid}/questions/preflight", json=data).json()
    assert time.monotonic() - started < 1
    assert response["status"] == "failed" and response["matches"]
    assert "keyword" in response["error"]
    with factory() as db:
        assert db.scalar(select(Question.id).where(Question.body_display == data["text"])) is None
    posted = s.post(f"/api/v1/courses/{cid}/questions", json={**data, "preflight_token": response["preflight_token"]})
    assert posted.status_code == 201


def test_splitter_applies_to_txt_transcripts_and_forum_without_fake_pages(room):
    from app.models import Transcript
    from app.ai.retrieval import index_session, index_question
    import tiktoken

    _, s, _, factory, cid, _, sid, _ = room
    question = post_question(s, cid, sid, "Binary search? " + "Long paragraph explaining sorted intervals. " * 150)
    with factory() as db:
        resource = Resource(
            course_id=cid,
            original_filename="long.txt",
            storage_key="long.txt",
            content_type="text/plain",
            size_bytes=1,
            sha256="test",
            kind="txt",
            process_status="ready",
            pages=[{"text": ("Paragraph about binary search. " * 400) + "\n\nAnother paragraph."}],
        )
        db.add(resource)
        db.add(
            Transcript(
                session_id=sid,
                item_id="long",
                text="Binary search sorted intervals. " * 400,
                start_ms=1200,
                end_ms=30000,
            )
        )
        db.commit()
        index_resource(db, Job(target_id=resource.id))
        index_session(db, Job(target_id=sid))
        index_question(db, Job(target_id=question["id"]))
        chunks = list(db.scalars(select(SourceChunk).where(SourceChunk.course_id == cid)))
        enc = tiktoken.get_encoding("cl100k_base")
        assert len(chunks) >= 6
        assert all(len(enc.encode(c.text)) <= 512 for c in chunks)
        assert all(c.page_number is None for c in chunks)
        assert all(c.chunk_metadata["end_char"] > c.chunk_metadata["start_char"] for c in chunks)
        assert all(c.start_ms == 1200 for c in chunks if c.session_id)
        # Incremental session indexing must not duplicate chunks.
        count = len(chunks)
        index_session(db, Job(target_id=sid))
        assert len(list(db.scalars(select(SourceChunk).where(SourceChunk.course_id == cid)))) == count


def test_optional_answer_deadline_preserves_source_links(room, monkeypatch):
    from app.config import settings
    from app.models import Course
    from app.ai.retrieval import OpenAIText

    _, s, _, factory, cid, _, sid, _ = room
    with factory() as db:
        db.get(Course, cid).settings_json = {"generated_answers": True}
        resource = db.scalar(select(Resource).where(Resource.course_id == cid))
        db.add(
            SourceChunk(
                course_id=cid,
                resource_id=resource.id,
                source_type="resource",
                title="notes",
                text="Binary search sorted interval",
                page_number=1,
            )
        )
        db.commit()

    async def slow(self, *args, **kwargs):
        await asyncio.sleep(2)

    monkeypatch.setattr(OpenAIText, "structured", slow)
    monkeypatch.setattr(settings(), "answer_timeout_seconds", 0.05)
    result = s.post(f"/api/v1/courses/{cid}/questions/preflight", json={"text": "Binary search sorted interval"}).json()
    assert result["status"] == "failed" and result["matches"] and result["generated_answer"] is None
    assert "summary" in result["error"] and result["preflight_token"]


def test_preflight_deadline_does_not_wait_for_blocked_thread(room, monkeypatch):
    import time
    import app.ai.retrieval as retrieval
    from app.config import settings

    _, student, _, _, cid, _, _, _ = room

    def blocked(*args):
        time.sleep(0.4)
        return [], []

    monkeypatch.setattr(retrieval, "_search", blocked)
    monkeypatch.setattr(settings(), "retrieval_timeout_seconds", 0.05)
    started = time.monotonic()
    response = student.post(
        f"/api/v1/courses/{cid}/questions/preflight", json={"text": "Binary search sorted interval"}
    ).json()
    assert time.monotonic() - started < 0.25
    assert response["status"] == "failed" and response["preflight_token"]
