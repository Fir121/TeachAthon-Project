"""Course-scoped FTS/pgvector source index. Embedding schema is fixed at creation."""

from alembic import op
import sqlalchemy as s
from pgvector.sqlalchemy import Vector
from app.config import settings

revision = "0005"
down_revision = "0004"


def upgrade():
    dimensions = settings().openai_embed_dimensions
    if not 1 <= dimensions <= 2000:
        raise RuntimeError("Embedding dimensions must be between 1 and 2000 for the HNSW vector index.")
    config = op.create_table(
        "embedding_config",
        s.Column("id", s.String(), primary_key=True),
        s.Column("model", s.String(), nullable=False),
        s.Column("dimensions", s.Integer(), nullable=False),
    )
    op.bulk_insert(config, [{"id": "active", "model": settings().openai_embed_model, "dimensions": dimensions}])
    op.create_table(
        "source_chunks",
        s.Column("id", s.String(36), primary_key=True),
        s.Column("course_id", s.String(36), s.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        s.Column("resource_id", s.String(36), s.ForeignKey("resources.id", ondelete="CASCADE")),
        s.Column("session_id", s.String(36), s.ForeignKey("lecture_sessions.id", ondelete="CASCADE")),
        s.Column("question_id", s.String(36), s.ForeignKey("questions.id", ondelete="CASCADE")),
        s.Column("answer_id", s.String(36), s.ForeignKey("answers.id", ondelete="CASCADE")),
        s.Column("source_type", s.String(), nullable=False),
        s.Column("title", s.String(), nullable=False),
        s.Column("text", s.String(), nullable=False),
        s.Column("page_number", s.Integer()),
        s.Column("start_ms", s.Integer()),
        s.Column("end_ms", s.Integer()),
        s.Column("embedding", Vector(dimensions)),
        s.Column("embedding_model", s.String()),
    )
    op.create_index("ix_source_chunks_course_id", "source_chunks", ["course_id"])
    op.execute("CREATE INDEX source_fts ON source_chunks USING gin (to_tsvector('english', text))")
    op.execute("CREATE INDEX source_vectors ON source_chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade():
    op.drop_table("source_chunks")
    op.drop_table("embedding_config")
