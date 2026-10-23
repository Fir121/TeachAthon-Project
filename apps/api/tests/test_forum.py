from test_classroom import room, post_question
from app.models import Answer, Question
from sqlalchemy import select


def test_forum_replies_permissions_and_live_carryover(room):
    t, s, o, factory, cid, lid, sid, _ = room
    q = post_question(s, cid, sid, "Why does the binary search interval shrink?")
    with factory() as db:
        private_reply = Answer(
            question_id=q["id"],
            body="Legacy private accommodation",
            visibility="private",
            anonymous=True,
            author_id=None,
            lecturer_authored=True,
        )
        db.add(private_reply)
        db.commit()
        private = private_reply.id
    assert s.get(f"/api/v1/questions/{q['id']}/answers").json() == []
    assert s.patch(f"/api/v1/answers/{private}", json={"body": "attack"}).status_code == 404
    answer = t.post(
        f"/api/v1/questions/{q['id']}/answer", json={"body": "Each comparison halves the sorted interval."}
    ).json()["id"]
    reply = s.post(
        f"/api/v1/questions/{q['id']}/comments", json={"body": "Thank you; the interval invariant makes sense."}
    ).json()["id"]
    assert o.get(f"/api/v1/questions/{q['id']}/answers").status_code == 404
    assert s.patch(f"/api/v1/answers/{reply}", json={"body": "Updated named reply"}).status_code == 200
    assert s.patch(f"/api/v1/answers/{answer}", json={"body": "Cannot change lecturer answer"}).status_code == 403
    with factory() as db:
        legacy_reply = Answer(
            question_id=q["id"],
            body="Legacy anonymous follow-up",
            anonymous=True,
            author_id=None,
            visibility="public",
            lecturer_authored=False,
        )
        db.add(legacy_reply)
        db.commit()
        anon = legacy_reply.id
    assert s.delete(f"/api/v1/answers/{anon}").status_code == 403
    assert t.delete(f"/api/v1/answers/{anon}").status_code == 204
    t.post(f"/api/v1/sessions/{sid}/end")
    rows = s.get(f"/api/v1/courses/{cid}/questions").json()
    assert any(row["id"] == q["id"] for row in rows)
    assert s.get(f"/api/v1/questions/{q['id']}/answers").json()[0]["lecturer_authored"]
    assert t.delete(f"/api/v1/courses/{cid}").status_code == 204
    assert s.get(f"/api/v1/questions/{q['id']}").status_code == 404


def test_invalid_text_upload_and_identifiers_have_actionable_errors(room):
    t, s, o, factory, cid, lid, sid, _ = room
    assert (
        t.post(
            f"/api/v1/courses/{cid}/resources", files={"file": ("bad.json", b"{invalid json", "application/json")}
        ).status_code
        == 415
    )
    assert (
        t.post(
            f"/api/v1/courses/{cid}/resources", files={"file": ("bad.txt", b"\xff\xfeinvalid", "text/plain")}
        ).status_code
        == 415
    )
    assert s.get("/api/v1/courses/not-a-uuid").status_code == 404
    assert s.get("/api/v1/sessions/not-a-uuid/snapshot").status_code == 404
