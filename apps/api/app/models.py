import uuid
from datetime import datetime, timezone
from sqlalchemy import ForeignKey, UniqueConstraint, CheckConstraint, JSON, Uuid, DateTime, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid():
    return str(uuid.uuid4())


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    name: Mapped[str]
    email: Mapped[str] = mapped_column(unique=True)
    password_hash: Mapped[str]
    role: Mapped[str]
    avatar_key: Mapped[str | None]
    __table_args__ = (CheckConstraint("role IN ('student','lecturer')"),)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    name: Mapped[str]
    description: Mapped[str] = mapped_column(default="")
    discoverable: Mapped[bool] = mapped_column(default=True)
    banner_key: Mapped[str | None]
    settings_json: Mapped[dict] = mapped_column(
        JSON, default=lambda: {"poll_mode": "manual", "poll_cooldown_seconds": 180, "generated_answers": False}
    )


class Membership(Base):
    __tablename__ = "memberships"
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str]
    status: Mapped[str] = mapped_column(default="active")
    __table_args__ = (
        CheckConstraint("role IN ('student','lecturer')"),
        CheckConstraint("status IN ('active','pending','removed')"),
    )


class Job(Base):
    __tablename__ = "processing_jobs"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    type: Mapped[str]
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    target_id: Mapped[str]
    status: Mapped[str] = mapped_column(default="queued")
    attempts: Mapped[int] = mapped_column(default=0)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(unique=True)
    email: Mapped[str | None]
    role: Mapped[str]
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(default=False)


class Folder(Base):
    __tablename__ = "folders"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("folders.id", ondelete="RESTRICT"))
    name: Mapped[str]


class Resource(Base):
    __tablename__ = "resources"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    folder_id: Mapped[str | None] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"))
    original_filename: Mapped[str]
    storage_key: Mapped[str]
    content_type: Mapped[str]
    size_bytes: Mapped[int]
    sha256: Mapped[str]
    kind: Mapped[str]
    process_status: Mapped[str] = mapped_column(default="queued")
    error_message: Mapped[str | None]
    indexing_enabled: Mapped[bool] = mapped_column(default=True)
    pages: Mapped[list] = mapped_column(JSON, default=list)
    extraction_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Lecture(Base):
    __tablename__ = "lectures"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    title: Mapped[str]
    banner_key: Mapped[str | None]
    slide_resource_id: Mapped[str] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"))
    outline_json: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LiveSession(Base):
    __tablename__ = "lecture_sessions"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    lecture_id: Mapped[str] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"), unique=True)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    join_code: Mapped[str] = mapped_column(unique=True)
    state: Mapped[str] = mapped_column(default="live")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active_slide_index: Mapped[int] = mapped_column(default=0)
    event_sequence: Mapped[int] = mapped_column(default=0)
    public_sequence: Mapped[int] = mapped_column(default=0)
    recording_enabled: Mapped[bool] = mapped_column(default=False)
    recording_state: Mapped[str] = mapped_column(default="disabled")
    transcript_state: Mapped[str] = mapped_column(default="off")
    context_paused: Mapped[bool] = mapped_column(default=False)
    poll_config: Mapped[dict] = mapped_column(JSON, default=dict)
    topic_json: Mapped[dict | None] = mapped_column(JSON)
    __table_args__ = (
        Index(
            "one_live_session_per_course",
            "course_id",
            unique=True,
            postgresql_where=text("state = 'live'"),
            sqlite_where=text("state = 'live'"),
        ),
    )


class SessionEvent(Base):
    __tablename__ = "session_events"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int]
    public_sequence: Mapped[int]
    event_type: Mapped[str]
    audience: Mapped[str] = mapped_column(default="course")
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    offset_ms: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("session_id", "sequence"),)


class Poll(Base):
    __tablename__ = "polls"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(default="How is this topic landing?")
    status: Mapped[str] = mapped_column(default="open")
    created_by: Mapped[str] = mapped_column(default="lecturer")
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        Index(
            "one_open_poll",
            "session_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
            sqlite_where=text("status = 'open'"),
        ),
    )


class PollVote(Base):
    __tablename__ = "poll_votes"
    poll_id: Mapped[str] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    option_index: Mapped[int]
    __table_args__ = (CheckConstraint("option_index >= 0 AND option_index < 4"),)


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="SET NULL"))
    body_original: Mapped[str]
    body_display: Mapped[str]
    ai_modified: Mapped[bool] = mapped_column(default=False)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    submission_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False))
    anonymous: Mapped[bool]
    visibility: Mapped[str]
    state: Mapped[str] = mapped_column(default="open")
    discussion_only: Mapped[bool] = mapped_column(default=False)
    auto_grouping_disabled: Mapped[bool] = mapped_column(default=False)
    request_parts: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    match_json: Mapped[dict] = mapped_column(JSON, default=lambda: {"state": "unavailable"})
    cluster_id: Mapped[str | None] = mapped_column(ForeignKey("question_clusters.id", ondelete="SET NULL"))
    __table_args__ = (
        UniqueConstraint("course_id", "author_id", "submission_id", name="question_submission_once"),
        CheckConstraint("NOT anonymous OR author_id IS NULL"),
        CheckConstraint("visibility IN ('public','private')"),
    )


class QuestionVote(Base):
    __tablename__ = "question_votes"
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class Answer(Base):
    __tablename__ = "answers"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    anonymous: Mapped[bool] = mapped_column(default=False)
    body: Mapped[str]
    visibility: Mapped[str]
    lecturer_authored: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (
        CheckConstraint("NOT anonymous OR author_id IS NULL"),
        CheckConstraint("visibility IN ('public','private')"),
    )


class AudioChunk(Base):
    __tablename__ = "audio_chunks"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[str]
    chunk_index: Mapped[int]
    start_ms: Mapped[int]
    end_ms: Mapped[int]
    storage_key: Mapped[str]
    sha256: Mapped[str]
    content_type: Mapped[str]
    __table_args__ = (
        UniqueConstraint("session_id", "group_id", "chunk_index"),
        CheckConstraint("start_ms >= 0 AND end_ms > start_ms"),
    )


class Recording(Base):
    __tablename__ = "recordings"
    session_id: Mapped[str] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="CASCADE"), primary_key=True)
    storage_key: Mapped[str]
    duration_ms: Mapped[int]


class Transcript(Base):
    __tablename__ = "transcript_segments"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="CASCADE"), index=True)
    resource_id: Mapped[str | None] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"))
    item_id: Mapped[str]
    start_ms: Mapped[int]
    end_ms: Mapped[int]
    text: Mapped[str]
    timing: Mapped[str] = mapped_column(default="input_window")
    __table_args__ = (
        UniqueConstraint("session_id", "item_id"),
        UniqueConstraint("resource_id", "item_id"),
        CheckConstraint("start_ms >= 0 AND end_ms >= start_ms"),
    )


from pgvector.sqlalchemy import Vector


class EmbeddingConfig(Base):
    __tablename__ = "embedding_config"
    id: Mapped[str] = mapped_column(primary_key=True)
    model: Mapped[str]
    dimensions: Mapped[int]


class SourceChunk(Base):
    __tablename__ = "source_chunks"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    resource_id: Mapped[str | None] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"))
    session_id: Mapped[str | None] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="CASCADE"))
    question_id: Mapped[str | None] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    answer_id: Mapped[str | None] = mapped_column(ForeignKey("answers.id", ondelete="CASCADE"))
    source_type: Mapped[str]
    title: Mapped[str]
    text: Mapped[str]
    page_number: Mapped[int | None]
    start_ms: Mapped[int | None]
    end_ms: Mapped[int | None]
    embedding: Mapped[list | None] = mapped_column(Vector().with_variant(JSON, "sqlite"))
    chunk_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    embedding_model: Mapped[str | None]


class Cluster(Base):
    __tablename__ = "question_clusters"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    session_id: Mapped[str | None] = mapped_column(ForeignKey("lecture_sessions.id", ondelete="CASCADE"))
    canonical_text: Mapped[str]
    manual: Mapped[bool] = mapped_column(default=False)
    decision_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Feedback(Base):
    __tablename__ = "poll_feedback"
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=uid)
    poll_id: Mapped[str] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"))
    text_original: Mapped[str]
    text_rewritten: Mapped[str | None]
    classification: Mapped[str] = mapped_column(default="unclassified")
    analysis_json: Mapped[dict] = mapped_column(JSON, default=dict)
    ai_modified: Mapped[bool] = mapped_column(default=False)
    linked_question_id: Mapped[str | None] = mapped_column(ForeignKey("questions.id", ondelete="SET NULL"))
