"""Privileged question groups and anonymous poll feedback."""

from alembic import op
import sqlalchemy as s

revision = "0006"
down_revision = "0005"


def upgrade():
    op.create_table(
        "question_clusters",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("course_id", s.String(36), s.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        s.Column("session_id", s.String(36), s.ForeignKey("lecture_sessions.id", ondelete="CASCADE")),
        s.Column("canonical_text", s.String(), nullable=False),
        s.Column("manual", s.Boolean(), nullable=False),
    )
    op.add_column(
        "questions", s.Column("cluster_id", s.String(36), s.ForeignKey("question_clusters.id", ondelete="SET NULL"))
    )
    op.create_table(
        "poll_feedback",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("poll_id", s.String(36), s.ForeignKey("polls.id", ondelete="CASCADE"), nullable=False),
        s.Column("text_original", s.String(), nullable=False),
        s.Column("text_rewritten", s.String()),
        s.Column("classification", s.String(), nullable=False),
        s.Column("ai_modified", s.Boolean(), nullable=False),
        s.Column("linked_question_id", s.String(36), s.ForeignKey("questions.id", ondelete="SET NULL")),
    )


def downgrade():
    op.drop_table("poll_feedback")
    op.drop_column("questions", "cluster_id")
    op.drop_table("question_clusters")
