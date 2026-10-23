import asyncio
import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from test_classroom import room, post_question
from app.ai.providers.openai import OpenAIEmbeddings, OpenAIText
from app.intelligence import group_question
from semantic_fixtures import group_decision
from app.models import Cluster, Question, SessionEvent


@pytest.mark.parametrize("split_count", [1, 2, 3])
def test_split_restores_individuals_and_dissolves_a_lone_remainder(room, split_count):
    t, s, o, factory, cid, _, sid, _ = room
    posts = [
        post_question(s, cid, sid, "Why does binary search halve the interval?"),
        post_question(s, cid, sid, "Explain the interval invariant", False, "private", factory=factory),
        post_question(s, cid, sid, "Why must the interval stay sorted?", True, "private", factory=factory),
    ]
    ids = [q["id"] for q in posts]
    gid = t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": ids}).json()["id"]
    t.post(f"/api/v1/questions/{ids[0]}/resolve")
    with factory() as db:
        before = {
            q.id: (q.body_original, q.body_display, q.state, q.match_json, q.visibility, q.author_id)
            for q in db.scalars(select(Question))
        }
    path = f"/api/v1/clusters/{gid}/split"
    assert s.post(path, json={"question_ids": ids[:split_count]}).status_code == 403
    assert o.post(path, json={"question_ids": ids[:split_count]}).status_code == 404
    assert t.post(path, json={"question_ids": ids[:split_count]}).status_code == 200
    with factory() as db:
        for i, qid in enumerate(ids):
            q = db.get(Question, qid)
            assert (q.body_original, q.body_display, q.state, q.match_json, q.visibility, q.author_id) == before[qid]
            detached = i < split_count or split_count >= 2
            assert q.cluster_id == (None if detached else gid)
            assert q.auto_grouping_disabled == detached
        remaining = list(db.scalars(select(Cluster)))
        assert len(remaining) == (1 if split_count == 1 else 0)
        if remaining:
            assert remaining[0].canonical_text in [posts[1]["text"], posts[2]["text"]]
        event = db.scalars(select(SessionEvent).where(SessionEvent.event_type == "question.cluster.updated")).all()[-1]
        assert event.audience == "lecturer"
    groups = t.get(f"/api/v1/sessions/{sid}/lecturer-queue?sort=newest").json()["groups"]
    assert len(groups) == (2 if split_count == 1 else 3)
    assert all(g["id"] is None for g in groups if len(g["questions"]) == 1)
    student = s.get(f"/api/v1/sessions/{sid}/snapshot").json()["questions"]
    assert [q["id"] for q in student] == [ids[0]]
    assert "auto_grouping_disabled" not in student[0]


def test_split_is_durable_for_source_and_candidate_but_allows_explicit_regrouping(room, monkeypatch):
    t, s, _, factory, cid, _, sid, _ = room
    ids = [
        post_question(s, cid, sid, wording)["id"] for wording in ["Explain binary search", "Explain interval search"]
    ]
    gid = t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": ids}).json()["id"]
    t.post(f"/api/v1/clusters/{gid}/split", json={"question_ids": ids})
    new_id = post_question(s, cid, sid, "Explain halving intervals")["id"]

    async def forbidden(*_):
        raise AssertionError("Manually split questions must not be sent for automatic regrouping")

    monkeypatch.setattr(OpenAIEmbeddings, "embed", forbidden)
    monkeypatch.setattr(OpenAIText, "structured", forbidden)
    with factory() as db:
        asyncio.run(group_question(db, ids[0]))
        asyncio.run(group_question(db, new_id))  # Split entries are also excluded as candidates.
        assert all(q.cluster_id is None for q in db.scalars(select(Question)))
    assert t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": [ids[0]]}).status_code == 422
    assert t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": [ids[0], ids[0]]}).status_code == 422
    regroup = t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": ids})
    assert regroup.status_code == 200
    with factory() as db:
        assert all(db.get(Question, qid).cluster_id == regroup.json()["id"] for qid in ids)
        assert all(not db.get(Question, qid).auto_grouping_disabled for qid in ids)


def test_delayed_automatic_group_result_cannot_undo_a_manual_split(room, monkeypatch):
    t, s, _, factory, cid, _, sid, _ = room
    ids = [
        post_question(s, cid, sid, wording)["id"] for wording in ["Explain binary search", "Explain interval search"]
    ]

    async def vectors(self, texts, **kwargs):
        return [[1.0, 0.0] for _ in texts]

    async def delayed(self, prompt, schema, **kwargs):
        decision = group_decision(prompt)
        gid = t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": ids}).json()["id"]
        assert t.post(f"/api/v1/clusters/{gid}/split", json={"question_ids": ids}).status_code == 200
        return decision

    monkeypatch.setattr(OpenAIEmbeddings, "embed", vectors)
    monkeypatch.setattr(OpenAIText, "structured", delayed)
    with factory() as db:
        asyncio.run(group_question(db, ids[0]))
        assert all(q.cluster_id is None and q.auto_grouping_disabled for q in db.scalars(select(Question)))
        assert list(db.scalars(select(Cluster))) == []


@pytest.mark.parametrize("action", ["dismiss", "delete"])
def test_single_visible_question_has_no_bulk_actions_and_lone_members_are_cleaned(room, action):
    t, s, _, factory, cid, _, sid, _ = room
    ids = [
        post_question(s, cid, sid, wording)["id"] for wording in ["Explain binary search", "Explain interval search"]
    ]
    gid = t.post(f"/api/v1/sessions/{sid}/clusters", json={"question_ids": ids}).json()["id"]
    t.post(f"/api/v1/questions/{ids[0]}/resolve")
    one = t.get(f"/api/v1/sessions/{sid}/lecturer-queue").json()["groups"]
    assert len(one) == 1 and one[0]["id"] is None and one[0]["canonical_text"] == "Explain interval search"
    both = t.get(f"/api/v1/sessions/{sid}/lecturer-queue?sort=newest").json()["groups"]
    assert len(both) == 1 and both[0]["id"] == gid and len(both[0]["questions"]) == 2
    if action == "dismiss":
        assert t.post(f"/api/v1/questions/{ids[0]}/dismiss").status_code == 200
    else:
        assert t.delete(f"/api/v1/questions/{ids[0]}").status_code == 204
    with factory() as db:
        assert db.get(Question, ids[1]).cluster_id is None
        assert db.get(Question, ids[1]).auto_grouping_disabled
        assert list(db.scalars(select(Cluster))) == []


def test_automatic_grouping_still_groups_eligible_questions(room, monkeypatch):
    _, s, _, factory, cid, _, sid, _ = room
    ids = [
        post_question(s, cid, sid, wording)["id"] for wording in ["Explain binary search", "Explain interval search"]
    ]

    async def vectors(self, texts, **kwargs):
        return [[1.0, 0.0] for _ in texts]

    async def equivalent(self, prompt, schema, **kwargs):
        return group_decision(prompt)

    monkeypatch.setattr(OpenAIEmbeddings, "embed", vectors)
    monkeypatch.setattr(OpenAIText, "structured", equivalent)
    with factory() as db:
        asyncio.run(group_question(db, ids[0]))
        groups = list(db.scalars(select(Cluster)))
        assert len(groups) == 1 and not groups[0].manual
        assert all(db.get(Question, qid).cluster_id == groups[0].id for qid in ids)


def test_migration_repairs_old_singletons_without_changing_questions(room, monkeypatch):
    _, s, _, factory, cid, _, sid, _ = room
    ids = [post_question(s, cid, sid, f"Explain interval number {i}")["id"] for i in range(4)]
    with factory() as db:
        clusters = [
            Cluster(course_id=cid, session_id=sid, canonical_text="Legacy group", manual=manual)
            for manual in [True, False, True, True]
        ]
        db.add_all(clusters)
        db.flush()
        for i, qid in enumerate(ids):
            q = db.get(Question, qid)
            q.cluster_id = clusters[min(i, 2)].id
        original = db.get(Question, ids[0])
        original.state = "answered"
        original.visibility = "private"
        original.anonymous = True
        original.author_id = None
        original.match_json = {"state": "removed"}
        db.commit()
        kept_group = clusters[2].id
        engine = db.get_bind()
    spec = importlib.util.spec_from_file_location("migration14", Path("alembic/versions/0014_split_groups.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE questions DROP COLUMN auto_grouping_disabled"))
        monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
        module.upgrade()
    with factory() as db:
        restored = db.get(Question, ids[0])
        assert restored.cluster_id is None and restored.auto_grouping_disabled
        assert restored.state == "answered" and restored.visibility == "private"
        assert restored.anonymous and restored.author_id is None and restored.match_json == {"state": "removed"}
        assert restored.body_original == restored.body_display == "Explain interval number 0"
        assert db.get(Question, ids[1]).cluster_id is None and not db.get(Question, ids[1]).auto_grouping_disabled
        assert [c.id for c in db.scalars(select(Cluster))] == [kept_group]
        assert all(db.get(Question, qid).cluster_id == kept_group for qid in ids[2:])
