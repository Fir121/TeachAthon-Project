import asyncio
import pytest
from sqlalchemy import select
from test_classroom import room
from app.intelligence import Classification, classify_feedback
from app.ai.providers.openai import OpenAIText
from app.models import Feedback, Question

NOTE = "Tell me more about irradiance I love the course what is systems design? course is nice"
REQUESTS = [
    {"source_quote": "Tell me more about irradiance", "question": "Please explain irradiance in more detail."},
    {"source_quote": "what is systems design?", "question": "What does systems design involve?"},
]


@pytest.mark.parametrize(
    "requests,complete",
    [
        (REQUESTS, True),
        (REQUESTS[:1], False),
        (REQUESTS[1:], False),
        ([], False),
        ([{"source_quote": "invented quotation", "question": "What is irradiance?"}], False),
    ],
)
def test_all_requests_remain_visible_and_original_stays_private(room, monkeypatch, requests, complete):
    t, s, _, factory, _, _, sid, student = room
    pid = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    assert s.post(f"/api/v1/polls/{pid}/feedback", json={"text": NOTE}).status_code == 202

    async def classify(*_):
        return Classification(classification="question", requests=requests)

    monkeypatch.setattr(OpenAIText, "structured", classify)
    with factory() as db:
        f = db.scalar(select(Feedback))
        asyncio.run(classify_feedback(db, f.id))
        q = db.get(Question, f.linked_question_id)
        assert q.author_id == student["id"] and q.visibility == "private"
        assert f.text_original == q.body_original == NOTE
        assert "irradiance" in q.body_display.lower() and "systems design" in q.body_display.lower()
        if complete:
            assert q.body_display == "Please explain irradiance in more detail.\n\nWhat does systems design involve?"
            assert q.ai_modified
        else:
            assert q.body_display == NOTE and not q.ai_modified
        qid = q.id
        # A recheck repairs an older incomplete extraction on the same unedited entry.
        q.body_display = "Tell me more about irradiance"
        db.commit()
        asyncio.run(classify_feedback(db, f.id))
        assert f.linked_question_id == qid
        assert "irradiance" in q.body_display.lower() and "systems design" in q.body_display.lower()
        assert len(list(db.scalars(select(Question)))) == 1
    assert s.get(f"/api/v1/questions/{qid}").status_code == 404
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").json()["questions"] == []


@pytest.mark.parametrize("protected", ["answered", "human_edit", "moved", "manual_group"])
def test_rechecks_preserve_human_resolution_edits_and_moderation(room, monkeypatch, protected):
    from app.models import now, Cluster

    t, s, _, factory, _, _, sid, _ = room
    pid = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    s.post(f"/api/v1/polls/{pid}/feedback", json={"text": NOTE})

    async def classify(*_):
        return Classification(classification="question", requests=REQUESTS)

    monkeypatch.setattr(OpenAIText, "structured", classify)
    with factory() as db:
        f = db.scalar(select(Feedback))
        asyncio.run(classify_feedback(db, f.id))
        q = db.get(Question, f.linked_question_id)
        q.body_display = "An existing protected question"
        if protected == "answered":
            q.state = "answered"
        elif protected == "human_edit":
            q.edited_at = now()
        elif protected == "moved":
            q.discussion_only = True
        else:
            cluster = Cluster(course_id=q.course_id, session_id=sid, canonical_text=q.body_display, manual=True)
            db.add(cluster)
            db.flush()
            q.cluster_id = cluster.id
        db.commit()
        asyncio.run(classify_feedback(db, f.id))
        assert q.body_display == "An existing protected question"
        assert q.state == ("answered" if protected == "answered" else "open")
