from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
import pytest
from test_classroom import room, post_question
from app.models import Lecture, Resource, SessionEvent, Question, LiveSession


def test_public_named_contract_and_author_only_wording(room):
    t, s, o, factory, cid, lid, sid, student = room
    for unwanted in [{"anonymous": True}, {"visibility": "private"}]:
        assert (
            s.post(f"/api/v1/courses/{cid}/questions/preflight", json={"text": "Question", **unwanted}).status_code
            == 422
        )
    q = post_question(s, cid, sid)
    assert q["author_id"] == student["id"] and not q["anonymous"] and q["visibility"] == "public"
    teacher_view = t.get(f"/api/v1/questions/{q['id']}").json()
    assert not teacher_view["can_edit"] and teacher_view["can_delete"]
    assert t.patch(f"/api/v1/questions/{q['id']}", json={"text": "Teacher rewriting student"}).status_code == 403
    reply = s.post(f"/api/v1/questions/{q['id']}/comments", json={"body": "Student's own words"}).json()["id"]
    row = t.get(f"/api/v1/questions/{q['id']}/answers").json()[0]
    assert not row["can_edit"] and row["can_delete"]
    assert t.patch(f"/api/v1/answers/{reply}", json={"body": "Changed"}).status_code == 403
    assert s.patch(f"/api/v1/answers/{reply}", json={"body": "Student correction"}).status_code == 200
    assert t.delete(f"/api/v1/answers/{reply}").status_code == 204
    assert s.get(f"/api/v1/questions/{q['id']}/answers").json() == []
    assert t.delete(f"/api/v1/questions/{q['id']}").status_code == 204
    assert s.get(f"/api/v1/questions/{q['id']}").status_code == 404
    with factory() as db:
        kinds = list(db.scalars(select(SessionEvent.event_type).where(SessionEvent.session_id == sid)))
        assert all(kind in kinds for kind in ["reply.created", "reply.updated", "reply.deleted", "question.deleted"])


def test_submission_retries_proof_actor_and_payload_binding(room):
    t, s, _, factory, cid, _, sid, student = room
    data = {"text": "Question with retry protection", "submission_id": str(uuid4()), "session_id": sid}
    proof = s.post(f"/api/v1/courses/{cid}/questions/preflight", json=data).json()["preflight_token"]
    payload = {**data, "preflight_token": proof}
    assert t.post(f"/api/v1/courses/{cid}/questions", json=payload).status_code == 409
    first = s.post(f"/api/v1/courses/{cid}/questions", json=payload).json()
    assert s.post(f"/api/v1/courses/{cid}/questions", json=payload).json()["id"] == first["id"]
    # A fresh proof for the same submission still returns the same committed question.
    payload["preflight_token"] = s.post(f"/api/v1/courses/{cid}/questions/preflight", json=data).json()[
        "preflight_token"
    ]
    assert s.post(f"/api/v1/courses/{cid}/questions", json=payload).json()["id"] == first["id"]
    changed = {**data, "text": "Different question with reused identifier"}
    changed["preflight_token"] = s.post(f"/api/v1/courses/{cid}/questions/preflight", json=changed).json()[
        "preflight_token"
    ]
    assert s.post(f"/api/v1/courses/{cid}/questions", json=changed).status_code == 409
    t.post(f"/api/v1/sessions/{sid}/end")
    assert s.post(f"/api/v1/courses/{cid}/questions", json=payload).json()["id"] == first["id"]
    with factory() as db:
        assert len(list(db.scalars(select(Question).where(Question.course_id == cid)))) == 1


def test_live_limit_per_course_idempotence_and_release(room):
    t, _, _, factory, cid, lid, sid, _ = room
    with factory() as db:
        rid = db.get(Lecture, lid).slide_resource_id
    other = t.post(
        f"/api/v1/courses/{cid}/lectures", json={"title": "Second lecture", "slide_resource_id": rid}
    ).json()["id"]
    conflict = t.post(f"/api/v1/lectures/{other}/sessions/start", json={})
    assert conflict.status_code == 409
    assert conflict.json()["active_session"] == {"id": sid, "title": "Search", "url": f"/sessions/{sid}"}
    assert t.post(f"/api/v1/lectures/{lid}/sessions/start", json={}).json()["id"] == sid
    with factory() as db:
        db.add(LiveSession(course_id=cid, lecture_id=other, join_code="OTHER"))
        with pytest.raises(IntegrityError):
            db.commit()
    cid2 = t.post("/api/v1/courses", json={"name": "Independent course"}).json()["id"]
    with factory() as db:
        original = db.get(Resource, rid)
        resource = Resource(
            course_id=cid2,
            original_filename="slides.pdf",
            storage_key="test2.pdf",
            content_type="application/pdf",
            size_bytes=100,
            sha256="test",
            kind="pdf",
            process_status="ready",
            pages=original.pages,
        )
        db.add(resource)
        db.commit()
        rid2 = resource.id
    lid2 = t.post(
        f"/api/v1/courses/{cid2}/lectures", json={"title": "Other course live", "slide_resource_id": rid2}
    ).json()["id"]
    assert t.post(f"/api/v1/lectures/{lid2}/sessions/start", json={}).status_code == 200
    t.post(f"/api/v1/sessions/{sid}/end")
    assert t.post(f"/api/v1/lectures/{other}/sessions/start", json={}).status_code == 200


def test_named_feedback_manual_routing_and_legacy_identity_preservation(room):
    from app.models import Feedback

    t, s, _, factory, cid, _, sid, student = room
    pid = t.post(f"/api/v1/sessions/{sid}/polls", json={}).json()["id"]
    data = {"text": "Please slow down this explanation", "purpose": "feedback", "session_id": sid}
    proof = s.post(f"/api/v1/courses/{cid}/questions/preflight", json=data).json()["preflight_token"]
    assert s.post(f"/api/v1/courses/{cid}/questions", json={**data, "preflight_token": proof}).status_code == 409
    assert s.post(f"/api/v1/polls/{pid}/feedback", json={"text": data["text"]}).status_code == 202
    with factory() as db:
        feedback = db.scalar(select(Feedback))
        assert feedback.author_id == student["id"]
        fid = feedback.id
        legacy = Feedback(poll_id=pid, text_original="Historical confidential feedback")
        db.add(legacy)
        db.commit()
        legacy_id = legacy.id
    public_seq = s.get(f"/api/v1/sessions/{sid}/snapshot").json()["session"]["seq"]
    for fid, author in [(fid, student["id"]), (legacy_id, None)]:
        qid = t.post(f"/api/v1/feedback/{fid}/route").json()["id"]
        assert t.post(f"/api/v1/feedback/{fid}/route").json()["id"] == qid
        assert s.get(f"/api/v1/questions/{qid}").status_code == 404
        with factory() as db:
            q = db.get(Question, qid)
            assert q.author_id == author and q.anonymous == (author is None) and q.visibility == "private"
    public = s.get(f"/api/v1/sessions/{sid}/snapshot").json()
    assert public["questions"] == [] and public["session"]["seq"] == public_seq
    feedback = t.get(f"/api/v1/sessions/{sid}/lecturer-queue").json()["feedback"]
    assert {f["author"] for f in feedback} == {"Student", "Anonymous (legacy)"}
