"""Named submissions, feedback attribution and one live lecture per course."""

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"


def upgrade():
    conflicts = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT course_id FROM lecture_sessions WHERE state = 'live' GROUP BY course_id HAVING count(*) > 1"
            )
        )
        .scalars()
        .all()
    )
    if conflicts:
        raise RuntimeError(
            "End extra live lectures explicitly before migrating. Conflicting course IDs: "
            + ", ".join(str(c) for c in conflicts)
        )
    op.add_column(
        "poll_feedback",
        sa.Column("author_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("questions", sa.Column("submission_id", sa.Uuid(as_uuid=False), nullable=True))
    op.create_unique_constraint("question_submission_once", "questions", ["course_id", "author_id", "submission_id"])
    op.create_index(
        "one_live_session_per_course",
        "lecture_sessions",
        ["course_id"],
        unique=True,
        postgresql_where=sa.text("state = 'live'"),
        sqlite_where=sa.text("state = 'live'"),
    )


def downgrade():
    op.drop_index("one_live_session_per_course", table_name="lecture_sessions")
    op.drop_constraint("question_submission_once", "questions", type_="unique")
    op.drop_column("questions", "submission_id")
    op.drop_column("poll_feedback", "author_id")
