"""Durable recording chunks and input-window transcript offsets."""

from alembic import op
import sqlalchemy as s

revision = "0004"
down_revision = "0003"


def upgrade():
    op.create_table(
        "audio_chunks",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("session_id", s.String(36), s.ForeignKey("lecture_sessions.id", ondelete="CASCADE"), nullable=False),
        s.Column("group_id", s.String(), nullable=False),
        s.Column("chunk_index", s.Integer(), nullable=False),
        s.Column("start_ms", s.Integer(), nullable=False),
        s.Column("end_ms", s.Integer(), nullable=False),
        s.Column("storage_key", s.String(), nullable=False),
        s.Column("sha256", s.String(), nullable=False),
        s.Column("content_type", s.String(), nullable=False),
        s.UniqueConstraint("session_id", "group_id", "chunk_index"),
        s.CheckConstraint("start_ms >= 0 AND end_ms > start_ms"),
    )
    op.create_table(
        "recordings",
        s.Column("session_id", s.String(36), s.ForeignKey("lecture_sessions.id", ondelete="CASCADE"), primary_key=True),
        s.Column("storage_key", s.String(), nullable=False),
        s.Column("duration_ms", s.Integer(), nullable=False),
    )
    op.create_table(
        "transcript_segments",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("session_id", s.String(36), s.ForeignKey("lecture_sessions.id", ondelete="CASCADE")),
        s.Column("resource_id", s.String(36), s.ForeignKey("resources.id", ondelete="CASCADE")),
        s.Column("item_id", s.String(), nullable=False),
        s.Column("start_ms", s.Integer(), nullable=False),
        s.Column("end_ms", s.Integer(), nullable=False),
        s.Column("text", s.String(), nullable=False),
        s.Column("timing", s.String(), nullable=False),
        s.UniqueConstraint("session_id", "item_id"),
        s.UniqueConstraint("resource_id", "item_id"),
        s.CheckConstraint("start_ms >= 0 AND end_ms >= start_ms"),
    )
    op.create_index("ix_audio_chunks_session_id", "audio_chunks", ["session_id"])
    op.create_index("ix_transcript_segments_session_id", "transcript_segments", ["session_id", "start_ms"])


def downgrade():
    for t in ["transcript_segments", "recordings", "audio_chunks"]:
        op.drop_table(t)
