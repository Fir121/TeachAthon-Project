"""Private interactive diagram analyses and lecturer-approved revisions."""

from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"


def upgrade():
    op.create_table(
        "diagram_analyses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lecture_id", sa.Uuid(), sa.ForeignKey("lectures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_fingerprint", sa.String(), nullable=False),
        sa.Column("fingerprints", sa.JSON(), nullable=False),
        sa.Column("suggestions", sa.JSON(), nullable=False),
        sa.Column("completed_pages", sa.Integer(), nullable=False),
        sa.Column("input_note", sa.String(), nullable=False),
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("processing_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("lecture_id", "source_fingerprint", name="diagram_analysis_source_once"),
    )
    op.create_table(
        "diagram_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lecture_id", sa.Uuid(), sa.ForeignKey("lectures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slide_index", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("source_fingerprint", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("feedback", sa.String(), nullable=False),
        sa.Column("artifact", sa.JSON()),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("processing_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("approved_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("lecture_id", "request_id", name="diagram_request_once"),
        sa.CheckConstraint("slide_index >= 0"),
        sa.CheckConstraint("status IN ('pending','preview','approved','rejected','superseded','stale')"),
    )
    op.create_index(
        "diagram_one_approved_slide",
        "diagram_revisions",
        ["lecture_id", "slide_index"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
        sqlite_where=sa.text("status = 'approved'"),
    )


def downgrade():
    op.drop_table("diagram_revisions")
    op.drop_table("diagram_analyses")
