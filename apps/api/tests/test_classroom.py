import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from conftest import signup
from app.models import Resource, Question, SessionEvent, PollVote, Membership


@pytest.fixture
def room(clients, tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings(), "media_root", str(tmp_path))
    t, s, o, factory = clients
    signup(t)
    student = signup(s, "student", "student@example.com")
    signup(o, "student", "outsider@example.com")
    cid = t.post("/api/v1/courses", json={"name": "Live course"}).json()["id"]
    t.post(f"/api/v1/courses/{cid}/members", json={"email": "student@example.com"})
    with factory() as db:
        r = Resource(
            course_id=cid,
            original_filename="deck.pdf",
            storage_key="test.pdf",
            content_type="application/pdf",
            size_bytes=100,
            sha256="test",
            kind="pdf",
            process_status="ready",
            pages=[
                {"text": "Binary search interval", "image": "0.png"},
                {"text": "Complexity logarithmic", "image": "1.png"},
            ],
        )
        db.add(r)
        db.commit()
        rid = r.id
    lid = t.post(f"/api/v1/courses/{cid}/lectures", json={"title": "Search", "slide_resource_id": rid}).json()["id"]
    sid = t.post(f"/api/v1/lectures/{lid}/sessions/start", json={}).json()["id"]
    return t, s, o, factory, cid, lid, sid, student


def post_question(
    client, cid, sid, text="Why is binary search logarithmic?", anonymous=False, visibility="public", factory=None
):
    if anonymous or visibility == "private":
        # Seed historical data: the current API no longer creates these submissions.
        assert factory is not None
        from app.questions import question_json, question_event
        from app.models import User

        user_id = client.get("/api/v1/auth/me").json()["id"]
        with factory() as db:
            user = db.get(User, user_id)
            q = Question(
                course_id=cid,
                session_id=sid,
                body_original=text,
                body_display=text,
                anonymous=anonymous,
                visibility=visibility,
                author_id=None if anonymous else user_id,
            )
            db.add(q)
            db.flush()
            question_event(db, q, "question.created")
            db.commit()
            return question_json(db, q, user, user.role == "lecturer")
    data = {"text": text, "session_id": sid}
    r = client.post(f"/api/v1/courses/{cid}/questions/preflight", json=data)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/courses/{cid}/questions", json={**data, "preflight_token": r.json()["preflight_token"]})
    assert r.status_code == 201, r.text
    return r.json()


def test_poll_and_slide_invariants(room):
    t, s, o, factory, cid, lid, sid, student = room
    assert o.get(f"/api/v1/sessions/{sid}/snapshot").status_code == 404
    assert s.post(f"/api/v1/sessions/{sid}/slides/change", json={"index": 1}).status_code == 403
    assert t.post(f"/api/v1/sessions/{sid}/slides/change", json={"index": 1}).status_code == 200
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").json()["session"]["active_slide_index"] == 1
    p1 = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    for option in [3, 1]:
        assert s.post(f"/api/v1/polls/{p1}/vote", json={"option_index": option}).status_code == 200
    assert t.get(f"/api/v1/polls/{p1}/results").json()["counts"] == [0, 1, 0, 0]
    assert s.get(f"/api/v1/polls/{p1}/results").status_code == 403
    assert "counts" not in s.get(f"/api/v1/sessions/{sid}/polls").json()[0]
    p2 = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    assert s.post(f"/api/v1/polls/{p1}/vote", json={"option_index": 0}).status_code == 409
    assert t.get(f"/api/v1/polls/{p1}/results").json()["status"] == "superseded"
    assert t.post(f"/api/v1/sessions/{sid}/end").status_code == 200
    assert t.post(f"/api/v1/lectures/{lid}/sessions/start", json={}).status_code == 409


def test_question_privacy_proof_and_anonymity(room):
    t, s, o, factory, cid, lid, sid, student = room
    before = s.get(f"/api/v1/sessions/{sid}/snapshot").json()["session"]["seq"]
    private = post_question(s, cid, sid, "Private health accommodation question", True, "private", factory=factory)
    assert private["author_id"] is None
    assert s.get(f"/api/v1/questions/{private['id']}").status_code == 404
    after = s.get(f"/api/v1/sessions/{sid}/snapshot").json()
    assert after["questions"] == [] and after["session"]["seq"] == before
    assert len(t.get(f"/api/v1/sessions/{sid}/snapshot").json()["questions"]) == 1
    pre = s.post(
        f"/api/v1/courses/{cid}/questions/preflight", json={"text": "Private health accommodation question"}
    ).json()
    assert all(m["source_id"] != private["id"] for m in pre["matches"])
    anon = post_question(s, cid, sid, anonymous=True, factory=factory)
    assert s.patch(f"/api/v1/questions/{anon['id']}", json={"text": "New body"}).status_code == 403
    assert s.delete(f"/api/v1/questions/{anon['id']}").status_code == 403
    named = post_question(s, cid, sid, text="How can I change a named question?")
    assert s.patch(f"/api/v1/questions/{named['id']}", json={"text": "Updated named question"}).status_code == 200
    assert o.get(f"/api/v1/questions/{named['id']}").status_code == 404
    assert (
        s.post(
            f"/api/v1/courses/{cid}/questions",
            json={
                "text": "Changed proof",
                "preflight_token": pre["preflight_token"],
            },
        ).status_code
        == 409
    )
    with factory() as db:
        assert db.get(Question, anon["id"]).author_id is None
        assert db.get(Question, private["id"]).author_id is None
        db.add(
            Question(
                course_id=cid,
                body_original="invalid",
                body_display="invalid",
                anonymous=True,
                author_id=student["id"],
                visibility="public",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
    t.post(f"/api/v1/questions/{anon['id']}/resolve")
    assert s.get(f"/api/v1/questions/{anon['id']}").json()["state"] == "answered"


def test_named_private_author_can_correct_or_delete_without_reading_private_threads(room):
    t, s, o, factory, cid, lid, sid, _ = room
    q = post_question(s, cid, sid, "Named private question before correction", False, "private", factory=factory)
    assert s.get(f"/api/v1/questions/{q['id']}").status_code == 404
    assert s.patch(f"/api/v1/questions/{q['id']}", json={"text": "Named private question corrected"}).status_code == 200
    assert t.get(f"/api/v1/questions/{q['id']}").json()["text"] == "Named private question corrected"
    assert o.patch(f"/api/v1/questions/{q['id']}", json={"text": "Not my question"}).status_code == 404
    assert s.delete(f"/api/v1/questions/{q['id']}").status_code == 204


def test_stale_worker_event_counters_are_allocated_atomically_without_private_sequence_gaps(room):
    from app.classroom import emit
    from app.models import LiveSession

    _, _, _, factory, _, _, sid, _ = room
    with factory() as worker_db, factory() as live_db:
        stale = worker_db.get(LiveSession, sid)
        original = (stale.event_sequence, stale.public_sequence)
        worker_db.commit()  # Simulate the assembly job's long external work.
        current = live_db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
        emit(live_db, current, "question.created", audience="lecturer")
        emit(live_db, current, "transcript.final")
        live_db.commit()
        # SQLAlchemy returns the cached instance even after SELECT FOR UPDATE.
        locked = worker_db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
        assert locked is stale and locked.event_sequence == original[0]
        event = emit(worker_db, locked, "recording.status", {"state": "ready"})
        worker_db.commit()
        assert event.sequence == original[0] + 3
        assert event.public_sequence == original[1] + 2
        rows = list(worker_db.scalars(select(SessionEvent).where(SessionEvent.session_id == sid)))
        assert len({row.sequence for row in rows}) == len(rows)


def test_annotations_preserve_legacy_and_slide_coordinates_and_clear_events(room):
    teacher, student, outsider, _, _, _, sid, _ = room
    legacy = {"index": 0, "stroke": [[0.1, 0.2], [0.3, 0.4]]}
    image_relative = {**legacy, "coordinates": "slide"}
    assert student.post(f"/api/v1/sessions/{sid}/annotations", json=image_relative).status_code == 403
    assert outsider.get(f"/api/v1/sessions/{sid}/timeline").status_code == 404
    assert teacher.post(f"/api/v1/sessions/{sid}/annotations", json=legacy).status_code == 200
    assert teacher.post(f"/api/v1/sessions/{sid}/annotations", json=image_relative).status_code == 200
    assert (
        teacher.post(
            f"/api/v1/sessions/{sid}/annotations", json={"index": 0, "stroke": [], "coordinates": "slide"}
        ).status_code
        == 200
    )
    events = student.get(f"/api/v1/sessions/{sid}/timeline").json()
    annotations = [event for event in events if event["type"] == "annotation.added"]
    assert [event["payload"]["coordinates"] for event in annotations] == ["stage", "slide", "slide"]
    assert annotations[-1]["payload"]["stroke"] == []
    assert len(student.get(f"/api/v1/sessions/{sid}/snapshot").json()["annotations"]) == 3
