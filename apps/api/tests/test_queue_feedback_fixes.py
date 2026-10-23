import asyncio
import importlib.util
from pathlib import Path
import pytest
from sqlalchemy import select, text
from alembic.migration import MigrationContext
from alembic.operations import Operations
from test_classroom import room, post_question
from app.models import Question, Feedback, LiveSession
from app.intelligence import classify_feedback, Classification
from app.ai.providers.openai import OpenAIText


def test_move_keeps_public_discussion_search_and_resolution(room):
    t, s, o, factory, cid, _, sid, student = room
    q = post_question(s, cid, sid, "Why does binary search need a sorted interval?")
    assert s.post(f"/api/v1/questions/{q['id']}/dismiss").status_code == 403
    assert t.post(f"/api/v1/questions/{q['id']}/dismiss").json() == {"state": "open", "discussion_only": True}
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").json()["questions"] == []
    assert t.get(f"/api/v1/sessions/{sid}/lecturer-queue").json()["groups"] == []
    forum = s.get(f"/api/v1/courses/{cid}/questions?sort=unanswered").json()
    assert len(forum) == 1 and forum[0]["id"] == q["id"] and forum[0]["discussion_only"]
    matches = s.get(f"/api/v1/courses/{cid}/search?q=binary%20search").json()["matches"]
    assert any(m["source_id"] == q["id"] for m in matches)
    assert o.get(f"/api/v1/questions/{q['id']}").status_code == 404
    assert t.post(f"/api/v1/questions/{q['id']}/resolve").status_code == 200
    assert t.post(f"/api/v1/questions/{q['id']}/dismiss").json()["state"] == "answered"
    assert s.get(f"/api/v1/questions/{q['id']}").json()["state"] == "answered"
    private = post_question(s, cid, sid, "Confidential note question", True, "private", factory=factory)
    t.post(f"/api/v1/questions/{private['id']}/dismiss")
    assert len(s.get(f"/api/v1/courses/{cid}/questions").json()) == 1
    assert o.get(f"/api/v1/questions/{private['id']}").status_code == 404


def test_answer_links_whole_recording_independently_of_excerpt(room):
    t, s, _, factory, cid, _, sid, _ = room
    q = post_question(s, cid, sid)
    assert s.get(f"/api/v1/questions/{q['id']}").json()["recording_answer"] is None
    t.post(f"/api/v1/questions/{q['id']}/resolve")
    with factory() as db:
        session = db.get(LiveSession, sid)
        session.recording_enabled = True
        session.recording_state = "capturing"
        db.get(Question, q["id"]).match_json = {"state": "unavailable", "message": "No exact excerpt"}
        db.commit()
    answer = s.get(f"/api/v1/questions/{q['id']}").json()
    assert answer["recording_answer"] == {"title": "Search", "url": f"/recordings/{sid}", "state": "live"}
    for state, display in [("queued", "processing"), ("ready", "ready"), ("no_audio", None), ("failed", None)]:
        with factory() as db:
            session = db.get(LiveSession, sid)
            session.state = "ended"
            session.recording_state = state
            db.commit()
        result = s.get(f"/api/v1/questions/{q['id']}").json()
        assert result["state"] == "answered"
        if display:
            assert result["recording_answer"]["state"] == display
            assert "?t=" not in result["recording_answer"]["url"]
        else:
            assert result["recording_answer"] is None


@pytest.mark.parametrize(
    "classification,original,rewrite,changed",
    [
        ("feedback", "I like this course", "I like this course.", False),
        ("feedback", "I like this course", "This class is enjoyable!", False),
        ("question", "why is the interval sorted", "Why is the interval sorted?", False),
        ("question", "why is the interval sorted", "Please explain why binary search needs a sorted interval.", True),
    ],
)
def test_notes_send_directly_and_only_meaningful_question_words_change(
    room, monkeypatch, classification, original, rewrite, changed
):
    t, s, o, factory, _, _, sid, student = room
    import app.ai.retrieval as retrieval

    def prohibited(*_):
        raise AssertionError("Notes must not run preflight/retrieval")

    monkeypatch.setattr(retrieval, "search", prohibited)
    pid = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    assert o.post(f"/api/v1/polls/{pid}/feedback", json={"text": original}).status_code == 404
    assert s.post(f"/api/v1/polls/{pid}/feedback", json={"text": original}).status_code == 202

    async def classify(*_):
        return Classification(
            classification=classification,
            requests=[{"source_quote": original, "question": rewrite}] if classification == "question" else [],
        )

    monkeypatch.setattr(OpenAIText, "structured", classify)
    with factory() as db:
        f = db.scalar(select(Feedback))
        asyncio.run(classify_feedback(db, f.id))
        assert f.text_original == original and f.author_id == student["id"]
        assert f.ai_modified == changed
        assert f.text_rewritten == (rewrite if changed else None)
        if classification == "question":
            q = db.get(Question, f.linked_question_id)
            assert q.visibility == "private" and q.body_original == original
            assert q.body_display == (rewrite if changed else original) and q.ai_modified == changed
        else:
            assert f.linked_question_id is None
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").json()["questions"] == []
    assert s.get(f"/api/v1/sessions/{sid}/lecturer-queue").status_code == 403
    t.post(f"/api/v1/polls/{pid}/close")
    assert s.post(f"/api/v1/polls/{pid}/feedback", json={"text": original}).status_code == 409


def test_migration_recovers_dismissed_and_cleans_cosmetic_feedback(room, monkeypatch):
    t, s, _, factory, cid, _, sid, _ = room
    q = post_question(s, cid, sid)
    t.post(f"/api/v1/questions/{q['id']}/resolve")
    pid = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    with factory() as db:
        db.get(Question, q["id"]).state = "dismissed"  # Historical behaviour.
        note = Feedback(
            poll_id=pid,
            text_original="I like this course",
            text_rewritten="I like this course.",
            classification="feedback",
            ai_modified=True,
        )
        db.add(note)
        db.commit()
        fid = note.id
        engine = db.get_bind()
    spec = importlib.util.spec_from_file_location("migration13", Path("alembic/versions/0013_discussion_feedback.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE questions DROP COLUMN discussion_only"))
        monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
        module.upgrade()
    with factory() as db:
        restored = db.get(Question, q["id"])
        assert restored.discussion_only and restored.state == "answered"
        feedback = db.get(Feedback, fid)
        assert (
            feedback.text_original == "I like this course"
            and feedback.text_rewritten is None
            and not feedback.ai_modified
        )
