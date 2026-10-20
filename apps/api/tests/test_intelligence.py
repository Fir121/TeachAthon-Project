import asyncio
from datetime import timedelta
import pytest
from app.models import LiveSession, Question, Transcript, Cluster, now
from app.intelligence import due_poll, match_excerpt, ExcerptChoice
from app.ai.providers.openai import OpenAIText
from test_classroom import room, post_question


def test_manual_private_public_group_and_resolution(room):
    t, s, o, factory, cid, lid, sid, _ = room
    public = post_question(s, cid, sid, "Why does binary search halve the interval?")
    private = post_question(s, cid, sid, "Please explain halving the binary search interval.", True, "private")
    assert s.get(f"/api/v1/sessions/{sid}/lecturer-queue").status_code == 403
    group = t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": [public["id"], private["id"]]}).json()[
        "id"
    ]
    assert s.post(f"/api/v1/clusters/{group}/resolve").status_code == 403
    assert t.post(f"/api/v1/clusters/{group}/resolve").status_code == 200
    assert s.get(f"/api/v1/questions/{public['id']}").json()["state"] == "answered"
    with factory() as db:
        assert db.get(Question, private["id"]).state == "answered"
    data = s.get(f"/api/v1/sessions/{sid}/snapshot").json()
    assert len(data["questions"]) == 1 and "cluster_id" not in data["questions"][0]


def test_poll_hysteresis_and_manual_override():
    s = LiveSession(poll_config={"poll_mode": "auto", "poll_cooldown_seconds": 180})
    assert not due_poll(s, {"last_transition_ms": 0}, None, 100000)
    assert due_poll(s, {"last_transition_ms": 0}, None, 200000)
    assert not due_poll(s, {"last_transition_ms": 0}, now(), 200000)
    s.poll_config = {"poll_mode": "manual", "poll_cooldown_seconds": 180}
    assert not due_poll(s, {}, None, 999999)


def test_unmarked_match_suggestion_never_resolves_or_leaks_to_student(room, monkeypatch):
    t, s, o, factory, cid, lid, sid, _ = room
    q = post_question(s, cid, sid, "Why does binary search halve the interval?")
    with factory() as db:
        segment = Transcript(
            session_id=sid,
            item_id="speech",
            text="Binary search halves the interval each time. This means only logarithmically many comparisons.",
            start_ms=1000,
            end_ms=7000,
        )
        db.add(segment)
        db.get(LiveSession, sid).state = "ended"
        db.get(LiveSession, sid).recording_enabled = True
        db.get(LiveSession, sid).recording_state = "ready"
        db.commit()
        tid = segment.id

    async def model(*_):
        return ExcerptChoice(source_id=tid, addresses_question=True, reason="explains logarithmic halving")

    monkeypatch.setattr(OpenAIText, "structured", model)
    with factory() as db:
        asyncio.run(match_excerpt(db, q["id"]))
        assert db.get(Question, q["id"]).state == "open"
    assert s.get(f"/api/v1/questions/{q['id']}").json()["match"]["state"] == "unavailable"
    assert t.get(f"/api/v1/questions/{q['id']}").json()["match"]["possibly_addressed"] is True
    t.post(f"/api/v1/questions/{q['id']}/resolve")
    with factory() as db:
        asyncio.run(match_excerpt(db, q["id"]))
    assert s.get(f"/api/v1/questions/{q['id']}").json()["state"] == "answered"
    t.delete(f"/api/v1/answer-sources/{q['id']}")
    with factory() as db:
        asyncio.run(match_excerpt(db, q["id"]))
    assert s.get(f"/api/v1/questions/{q['id']}").json()["match"]["state"] == "removed"


def test_topic_checkpoint_opens_exactly_one_automatic_poll(room, monkeypatch):
    from app.intelligence import infer_topic, TopicOutput
    from app.models import Poll
    from sqlalchemy import select

    t, s, o, factory, cid, lid, sid, _ = room
    with factory() as db:
        session = db.get(LiveSession, sid)
        session.started_at = now() - timedelta(seconds=250)
        session.poll_config = {"poll_mode": "auto", "poll_cooldown_seconds": 60}
        session.topic_json = {"topic": "Binary search", "last_transition_ms": 0, "inferred_at_ms": 0}
        db.commit()

    async def checkpoint(*_):
        return TopicOutput(
            topic="Correctness invariants",
            subtopic="Loop invariant",
            transition=True,
            new_checkpoint=True,
            brief_reason="Previous explanation complete",
        )

    monkeypatch.setattr(OpenAIText, "structured", checkpoint)
    with factory() as db:
        asyncio.run(infer_topic(db, sid))
        asyncio.run(infer_topic(db, sid))
        assert len(list(db.scalars(select(Poll).where(Poll.session_id == sid, Poll.status == "open")))) == 1
        db.get(LiveSession, sid).context_paused = True
        db.commit()
        asyncio.run(infer_topic(db, sid))
        assert len(list(db.scalars(select(Poll).where(Poll.session_id == sid)))) == 1


def test_feedback_requires_preflight_and_routes_anonymously(room, monkeypatch):
    from app.models import Feedback
    from app.intelligence import classify_feedback, Classification
    from sqlalchemy import select

    t, s, o, factory, cid, lid, sid, _ = room
    pid = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    text = "Could you explain the sorted interval invariant?"
    assert s.post(f"/api/v1/polls/{pid}/feedback", json={"text": text}).status_code == 422
    proof = s.post(
        f"/api/v1/courses/{cid}/questions/preflight",
        json={"text": text, "anonymous": True, "visibility": "private", "session_id": sid},
    ).json()["preflight_token"]
    assert s.post(f"/api/v1/polls/{pid}/feedback", json={"text": text, "preflight_token": proof}).status_code == 202

    async def classify(*_):
        return Classification(classification="question", soft_rewrite="Please explain the sorted interval invariant.")

    monkeypatch.setattr(OpenAIText, "structured", classify)
    with factory() as db:
        f = db.scalar(select(Feedback))
        asyncio.run(classify_feedback(db, f.id))
        q = db.get(Question, f.linked_question_id)
        assert q.author_id is None and q.anonymous and q.visibility == "private"
        assert q.body_original == text and q.ai_modified
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").json()["questions"] == []
    assert t.get(f"/api/v1/sessions/{sid}/lecturer-queue").json()["feedback"][0]["text_original"] == text
