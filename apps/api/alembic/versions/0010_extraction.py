"""Versioned extraction checkpoints and source offsets, preserving current usable data."""

from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"


def upgrade():
    op.add_column("resources", sa.Column("extraction_json", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("source_chunks", sa.Column("chunk_metadata", sa.JSON(), nullable=False, server_default="{}"))


def downgrade():
    op.drop_column("source_chunks", "chunk_metadata")
    op.drop_column("resources", "extraction_json")
