"""Keep single-pass feedback provenance and conservative automatic grouping evidence."""

from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"


def upgrade():
    op.add_column("questions", sa.Column("request_parts", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    op.add_column(
        "poll_feedback", sa.Column("analysis_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
    )
    op.add_column(
        "question_clusters", sa.Column("decision_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
    )


def downgrade():
    op.drop_column("question_clusters", "decision_json")
    op.drop_column("poll_feedback", "analysis_json")
    op.drop_column("questions", "request_parts")
