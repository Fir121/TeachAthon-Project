"""Internal lecturer grouping policy; never exposed in student question data."""

from sqlalchemy import select
from .models import Cluster, Question


def can_auto_group(db, question):
    if not question or question.state != "open" or question.discussion_only or question.auto_grouping_disabled:
        return False
    cluster = db.get(Cluster, question.cluster_id) if question.cluster_id else None
    return not cluster or not cluster.manual


def dissolve_small_groups(db, cluster_ids):
    """A group needs two members. Preserve manual decisions without singleton clusters."""
    db.flush()
    for cid in set(cluster_ids) - {None}:
        cluster = db.get(Cluster, cid)
        if not cluster:
            continue
        members = list(db.scalars(select(Question).where(Question.cluster_id == cid)))
        if len(members) >= 2:
            if cluster.canonical_text not in [question.body_display for question in members]:
                cluster.canonical_text = members[0].body_display
            continue
        for question in members:
            question.cluster_id = None
            if cluster.manual:
                question.auto_grouping_disabled = True
        db.flush()
        db.delete(cluster)
