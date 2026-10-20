"""Identity, course memberships and durable worker jobs."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.CheckConstraint("role IN ('student','lecturer')"),
    )
    op.create_table(
        "login_sessions",
        sa.Column("token_hash", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "courses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("discoverable", sa.Boolean(), nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=False),
    )
    op.create_table(
        "memberships",
        sa.Column("course_id", sa.String(36), sa.ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.CheckConstraint("role IN ('student','lecturer')"),
        sa.CheckConstraint("status IN ('active','pending','removed')"),
    )
    op.create_table(
        "processing_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("course_id", sa.String(36), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.String()),
    )


def downgrade():
    for name in ("processing_jobs", "memberships", "courses", "login_sessions", "users"):
        op.drop_table(name)
