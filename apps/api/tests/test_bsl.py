import httpx
import pytest
from app import bsl
from app.config import settings
from app.models import Transcript
from test_classroom import room  # noqa: F401 - shared fixture


@pytest.fixture
def signing(room, monkeypatch):
    t, s, o, factory, cid, lid, sid, _ = room
    monkeypatch.setattr(settings(), "bsl_enabled", True)
    bsl.CACHE.clear()
    bsl.RATES.clear()
    with factory() as db:
        caption = Transcript(session_id=sid, item_id="final-1", text="Read a book.", start_ms=1000, end_ms=6000)
        db.add(caption)
        db.commit()
        tid = caption.id
    return t, s, o, factory, cid, lid, sid, tid


def response(glosses=None):
    return httpx.Response(
        200,
        json={
            "glosses": glosses or ["read(v)#1", "book(n)#1"],
            "missing": [],
            "supported": True,
            "planner": "Kozha rule-based",
        },
    )


def test_only_membership_students_and_persisted_session_captions(signing, monkeypatch):
    t, s, o, factory, cid, lid, sid, tid = signing
    calls = []
    monkeypatch.setattr(bsl, "internal", lambda path, data=None: calls.append((path, data)) or response())
    url = f"/api/v1/sessions/{sid}/bsl/plan"
    assert t.post(url, json={"caption_id": tid}).status_code == 403
    assert o.post(url, json={"caption_id": tid}).status_code == 404
    assert s.post(url, json={"caption_id": tid, "text": "Arbitrary input"}).status_code == 422
    from uuid import uuid4

    assert s.post(url, json={"caption_id": str(uuid4())}).status_code == 404
    assert calls == []
    assert s.post(url, json={"caption_id": tid}).json()["supported"] is True
    assert calls == [("/plan", {"text": "Read a book."})]
    t.delete(f"/api/v1/courses/{cid}/members/{s.get('/api/v1/auth/me').json()['id']}")
    assert s.post(url, json={"caption_id": tid}).status_code == 404
    assert len(calls) == 1


def test_duplicate_caption_plan_is_cached_and_replay_uses_same_timestamps(signing, monkeypatch):
    t, s, o, factory, cid, lid, sid, tid = signing
    calls = []
    monkeypatch.setattr(bsl, "internal", lambda path, data=None: calls.append(data) or response())
    url = f"/api/v1/sessions/{sid}/bsl/plan"
    first = s.post(url, json={"caption_id": tid}).json()
    assert s.post(url, json={"caption_id": tid}).json() == first
    t.post(f"/api/v1/sessions/{sid}/end")
    assert s.post(url, json={"caption_id": tid}).json() == first
    assert first["start_ms"] == 1000 and first["end_ms"] == 6000
    assert len(calls) == 1


def test_unavailable_renderer_and_planner_preserve_captions(signing, monkeypatch):
    t, s, o, factory, cid, lid, sid, tid = signing
    monkeypatch.setattr(settings(), "bsl_enabled", False)
    assert s.get(f"/api/v1/sessions/{sid}/bsl/config").json()["enabled"] is False
    assert s.post(f"/api/v1/sessions/{sid}/bsl/plan", json={"caption_id": tid}).status_code == 503
    assert s.get(f"/api/v1/sessions/{sid}/transcript").json()[0]["text"] == "Read a book."
    monkeypatch.setattr(settings(), "bsl_enabled", True)

    def failed(*args, **kwargs):
        raise httpx.ConnectError("private internals must not escape")

    from fastapi import HTTPException

    with monkeypatch.context() as patch:
        patch.setattr(httpx.Client, "request", failed)
        with pytest.raises(HTTPException) as error:
            bsl.internal("/assets/cwa/allcsa.js")
        assert error.value.status_code == 503
        assert "private internals" not in error.value.detail
    assert s.get(f"/api/v1/sessions/{sid}/snapshot").status_code == 200


def test_renderer_paths_headers_message_boundary_and_license(signing):
    t, s, o, factory, cid, lid, sid, tid = signing
    base = f"/api/v1/sessions/{sid}/bsl/assets/"
    assert s.get(base + "panel.html").status_code == 403
    r = s.get(base + "panel.html", headers={"Sec-Fetch-Dest": "iframe"})
    assert r.status_code == 200
    assert "frame-ancestors 'self'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"
    assert s.get(base + "server/server.py").status_code == 404
    assert s.get(base + "data/bsl_alphabet_sigml.sigml").status_code == 404
    assert o.get(base + "panel.js").status_code == 404
    assert t.get(base + "panel.js").status_code == 403
    js = s.get(base + "panel.js").text
    assert "e.origin !== origin" in js and "e.source !== window.parent" in js
    assert "d.type !== 'play_glosses'" in js
    assert "fingerspellWord" not in js and "play_sigml" not in js
    credits = s.get(base + "credits.txt").text
    assert all(word in credits for word in ("MIT License", "CWASA", "BY-NC-SA", "DictaSign"))


def test_caption_segmentation_and_recent_tail_are_stable(signing, monkeypatch):
    t, s, o, factory, cid, lid, sid, tid = signing
    text = "Read a book. " * 50
    parts = bsl.split_caption(text)
    assert len(parts) > 1 and all(0 < len(p.strip()) <= 180 for p in parts)
    assert " ".join("".join(parts).split()) == " ".join(text.split())
    with factory() as db:
        original = db.get(Transcript, tid)
        original.text = text
        db.add(Transcript(session_id=sid, item_id="final-2", text="Ask a question.", start_ms=7000, end_ms=11000))
        db.commit()
    assert s.get(f"/api/v1/sessions/{sid}/transcript?recent=1").json()[0]["item_id"] == "final-2"
    assert len(s.get(f"/api/v1/sessions/{sid}/transcript").json()) == 2
    assert s.get(f"/api/v1/sessions/{sid}/transcript?recent=33").status_code == 422
    monkeypatch.setattr(bsl, "internal", lambda path, data=None: response())
    plan = s.post(f"/api/v1/sessions/{sid}/bsl/plan", json={"caption_id": tid, "part": 1}).json()
    assert plan["parts"] == len(parts) and plan["start_ms"] == 1000 and plan["end_ms"] == 6000


def test_malformed_and_unsupported_plans_never_claim_signing(signing, monkeypatch):
    t, s, o, factory, cid, lid, sid, tid = signing
    url = f"/api/v1/sessions/{sid}/bsl/plan"
    monkeypatch.setattr(bsl, "internal", lambda *a: httpx.Response(200, json={"sigml": "<invented/>"}))
    assert s.post(url, json={"caption_id": tid}).status_code == 503
    monkeypatch.setattr(
        bsl,
        "internal",
        lambda *a: httpx.Response(
            200, json={"glosses": [], "missing": ["quicksort"], "supported": False, "planner": "Kozha"}
        ),
    )
    data = s.post(url, json={"caption_id": tid}).json()
    assert data["supported"] is False and data["glosses"] == []
    assert s.post(url, json={"caption_id": tid, "part": 31}).status_code == 422


def test_rate_limit_does_not_reset_on_rejection(signing, monkeypatch):
    import time

    t, s, o, factory, cid, lid, sid, tid = signing
    user_id = s.get("/api/v1/auth/me").json()["id"]
    bsl.RATES[user_id] = [time.monotonic()] * 60
    monkeypatch.setattr(bsl, "internal", lambda *args: pytest.fail("must not call planner"))
    url = f"/api/v1/sessions/{sid}/bsl/plan"
    for _ in range(3):
        assert s.post(url, json={"caption_id": tid}).status_code == 429
    assert len(bsl.RATES[user_id]) == 60
