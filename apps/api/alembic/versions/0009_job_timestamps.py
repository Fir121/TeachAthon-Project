"""Order processing status by job creation, independently of retry backoff."""

from alembic import op
import sqlalchemy as s

revision = "0009"
down_revision = "0008"


def upgrade():
    op.add_column(
        "processing_jobs",
        s.Column("created_at", s.DateTime(timezone=True), nullable=False, server_default=s.func.now()),
    )
    op.add_column(
        "processing_jobs",
        s.Column("updated_at", s.DateTime(timezone=True), nullable=False, server_default=s.func.now()),
    )


def downgrade():
    op.drop_column("processing_jobs", "updated_at")
    op.drop_column("processing_jobs", "created_at")
