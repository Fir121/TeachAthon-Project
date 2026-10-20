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
    assert any(m["source_type"] == "lecture_explanation" and m["start_ms"] == 1000 for m in result["matches"])
    document = next(m for m in result["matches"] if m["source_type"] == "resource")
    assert document["url"].startswith("/resources/") and document["url"].endswith("?page=1")
    assert document["start_ms"] is None
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
    assert all(m["source_type"] != "resource" for m in result["matches"])


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
