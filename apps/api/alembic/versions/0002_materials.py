"""Course invitations, folders, converted resources and lectures."""

from alembic import op
import sqlalchemy as s

revision = "0002"
down_revision = "0001"


def upgrade():
    op.create_table(
        "invitations",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("course_id", s.String(36), s.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        s.Column("token_hash", s.String(), unique=True, nullable=False),
        s.Column("email", s.String()),
        s.Column("role", s.String(), nullable=False),
        s.Column("expires_at", s.DateTime(timezone=True), nullable=False),
        s.Column("used", s.Boolean(), nullable=False),
    )
    op.create_table(
        "folders",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("course_id", s.String(36), s.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        s.Column("parent_id", s.String(36), s.ForeignKey("folders.id", ondelete="RESTRICT")),
        s.Column("name", s.String(), nullable=False),
    )
    op.create_table(
        "resources",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("course_id", s.String(36), s.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        s.Column("folder_id", s.String(36), s.ForeignKey("folders.id", ondelete="SET NULL")),
        s.Column("original_filename", s.String(), nullable=False),
        s.Column("storage_key", s.String(), nullable=False),
        s.Column("content_type", s.String(), nullable=False),
        s.Column("size_bytes", s.BigInteger(), nullable=False),
        s.Column("sha256", s.String(), nullable=False),
        s.Column("kind", s.String(), nullable=False),
        s.Column("process_status", s.String(), nullable=False),
        s.Column("error_message", s.String()),
        s.Column("indexing_enabled", s.Boolean(), nullable=False),
        s.Column("pages", s.JSON(), nullable=False),
        s.Column("created_at", s.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "lectures",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("course_id", s.String(36), s.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        s.Column("title", s.String(), nullable=False),
        s.Column("slide_resource_id", s.String(36), s.ForeignKey("resources.id", ondelete="RESTRICT"), nullable=False),
        s.Column("outline_json", s.JSON()),
        s.Column("created_at", s.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_resources_course", "resources", ["course_id"])


def downgrade():
    for name in ("lectures", "resources", "folders", "invitations"):
        op.drop_table(name)
