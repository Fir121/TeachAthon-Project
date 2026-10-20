"""Live classroom, durable events, polls and persistent Q&A."""

from alembic import op
import sqlalchemy as s

revision = "0003"
down_revision = "0002"


def ident():
    return s.Column("id", s.String(36), primary_key=True)


def fk(name, target, nullable=False, delete="CASCADE"):
    return s.Column(name, s.String(36), s.ForeignKey(target, ondelete=delete), nullable=nullable)


def col(name, type, nullable=False):
    return s.Column(name, type, nullable=nullable)


def upgrade():
    op.create_table(
        "lecture_sessions",
        ident(),
        fk("lecture_id", "lectures.id"),
        fk("course_id", "courses.id"),
        col("join_code", s.String()),
        col("state", s.String()),
        col("started_at", s.DateTime(timezone=True)),
        col("ended_at", s.DateTime(timezone=True), True),
        col("active_slide_index", s.Integer()),
        col("event_sequence", s.Integer()),
        col("public_sequence", s.Integer()),
        col("recording_enabled", s.Boolean()),
        col("recording_state", s.String()),
        col("transcript_state", s.String()),
        col("context_paused", s.Boolean()),
        col("poll_config", s.JSON()),
        col("topic_json", s.JSON(), True),
        s.UniqueConstraint("lecture_id"),
        s.UniqueConstraint("join_code"),
    )
    op.create_table(
        "session_events",
        ident(),
        fk("session_id", "lecture_sessions.id"),
        col("sequence", s.Integer()),
        col("public_sequence", s.Integer()),
        col("event_type", s.String()),
        col("audience", s.String()),
        col("payload_json", s.JSON()),
        col("offset_ms", s.Integer()),
        col("created_at", s.DateTime(timezone=True)),
        s.UniqueConstraint("session_id", "sequence"),
    )
    op.create_table(
        "polls",
        ident(),
        fk("session_id", "lecture_sessions.id"),
        col("prompt", s.String()),
        col("status", s.String()),
        col("created_by", s.String()),
        col("opened_at", s.DateTime(timezone=True)),
        col("closed_at", s.DateTime(timezone=True), True),
    )
    op.create_index("one_open_poll", "polls", ["session_id"], unique=True, postgresql_where=s.text("status = 'open'"))
    op.create_table(
        "poll_votes",
        fk("poll_id", "polls.id"),
        fk("user_id", "users.id"),
        col("option_index", s.Integer()),
        s.PrimaryKeyConstraint("poll_id", "user_id"),
        s.CheckConstraint("option_index >= 0 AND option_index < 4"),
    )
    op.create_table(
        "questions",
        ident(),
        fk("course_id", "courses.id"),
        fk("session_id", "lecture_sessions.id", True, "SET NULL"),
        col("body_original", s.String()),
        col("body_display", s.String()),
        col("ai_modified", s.Boolean()),
        fk("author_id", "users.id", True, "SET NULL"),
        col("anonymous", s.Boolean()),
        col("visibility", s.String()),
        col("state", s.String()),
        col("created_at", s.DateTime(timezone=True)),
        col("edited_at", s.DateTime(timezone=True), True),
        col("match_json", s.JSON()),
        s.CheckConstraint("NOT anonymous OR author_id IS NULL"),
        s.CheckConstraint("visibility IN ('public','private')"),
    )
    op.create_table(
        "question_votes",
        fk("question_id", "questions.id"),
        fk("user_id", "users.id"),
        s.PrimaryKeyConstraint("question_id", "user_id"),
    )
    op.create_table(
        "answers",
        ident(),
        fk("question_id", "questions.id"),
        fk("author_id", "users.id", True, "SET NULL"),
        col("anonymous", s.Boolean()),
        col("body", s.String()),
        col("visibility", s.String()),
        col("lecturer_authored", s.Boolean()),
        col("created_at", s.DateTime(timezone=True)),
        s.CheckConstraint("NOT anonymous OR author_id IS NULL"),
        s.CheckConstraint("visibility IN ('public','private')"),
    )
    for table, column in [
        ("lecture_sessions", "course_id"),
        ("session_events", "session_id"),
        ("polls", "session_id"),
        ("questions", "course_id"),
        ("answers", "question_id"),
    ]:
        op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade():
    for table in [
        "answers",
        "question_votes",
        "questions",
        "poll_votes",
        "polls",
        "session_events",
        "lecture_sessions",
    ]:
        op.drop_table(table)
