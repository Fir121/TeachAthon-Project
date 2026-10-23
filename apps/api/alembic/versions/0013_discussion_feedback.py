"""Separate live dismissal from resolution, recover discussions, preserve original notes."""

from datetime import datetime, timezone
import re
import unicodedata
from uuid import UUID, uuid4
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"


def upgrade():
    op.add_column("questions", sa.Column("discussion_only", sa.Boolean(), nullable=False, server_default=sa.false()))
    bind = op.get_bind()
    metadata = sa.MetaData()
    questions = sa.Table("questions", metadata, autoload_with=bind)
    events = sa.Table("session_events", metadata, autoload_with=bind)
    answers = sa.Table("answers", metadata, autoload_with=bind)
    jobs = sa.Table("processing_jobs", metadata, autoload_with=bind)
    jobs.c.id.type = sa.Uuid(as_uuid=False)
    dismissed = bind.execute(sa.select(questions).where(questions.c.state == "dismissed")).mappings().all()
    if dismissed:
        # Restore answered only from persisted human actions, never from AI guesses.
        answered_ids = {
            str(UUID(str(qid)))
            for qid in bind.execute(
                sa.select(answers.c.question_id).where(answers.c.lecturer_authored.is_(True))
            ).scalars()
        }
        for payload in bind.execute(
            sa.select(events.c.payload_json).where(events.c.event_type == "question.answered")
        ).scalars():
            if payload.get("id"):
                answered_ids.add(str(UUID(str(payload["id"]))))
        at = datetime.now(timezone.utc)
        for q in dismissed:
            bind.execute(
                questions.update()
                .where(questions.c.id == q["id"])
                .values(
                    discussion_only=True,
                    cluster_id=None,
                    state="answered" if str(UUID(str(q["id"]))) in answered_ids else "open",
                )
            )
            if (
                q["visibility"] == "public"
                and not bind.execute(
                    sa.select(jobs.c.id).where(
                        jobs.c.target_id == str(UUID(str(q["id"]))),
                        jobs.c.type == "index_question",
                        jobs.c.status.in_(["queued", "processing"]),
                    )
                ).first()
            ):
                bind.execute(
                    jobs.insert().values(
                        id=str(uuid4()),
                        type="index_question",
                        course_id=q["course_id"],
                        target_id=str(UUID(str(q["id"]))),
                        status="queued",
                        attempts=0,
                        next_run_at=at,
                        created_at=at,
                        updated_at=at,
                    )
                )

    feedback = sa.Table("poll_feedback", metadata, autoload_with=bind)

    def words(value):
        return re.findall(r"\w+", unicodedata.normalize("NFKC", value).casefold())

    for f in bind.execute(sa.select(feedback).where(feedback.c.text_rewritten.is_not(None))).mappings().all():
        if f["classification"] != "question" or words(f["text_original"]) == words(f["text_rewritten"]):
            bind.execute(
                feedback.update().where(feedback.c.id == f["id"]).values(text_rewritten=None, ai_modified=False)
            )
            if f["linked_question_id"]:
                # Do not overwrite any human edit or substantive question rewrite.
                bind.execute(
                    questions.update()
                    .where(
                        questions.c.id == f["linked_question_id"],
                        questions.c.visibility == "private",
                        questions.c.edited_at.is_(None),
                        questions.c.ai_modified.is_(True),
                        questions.c.body_original == f["text_original"],
                        questions.c.body_display == f["text_rewritten"],
                    )
                    .values(body_display=f["text_original"], ai_modified=False)
                )


def downgrade():
    # Data corrections intentionally survive rollback; no original content is discarded.
    op.drop_column("questions", "discussion_only")
