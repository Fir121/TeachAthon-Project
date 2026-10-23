"""Restore split questions as individuals without undoing manual grouping decisions."""

from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"


def upgrade():
    op.add_column(
        "questions", sa.Column("auto_grouping_disabled", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    bind = op.get_bind()
    metadata = sa.MetaData()
    questions = sa.Table("questions", metadata, autoload_with=bind)
    clusters = sa.Table("question_clusters", metadata, autoload_with=bind)
    small = bind.execute(
        sa.select(clusters.c.id, clusters.c.manual)
        .outerjoin(questions, questions.c.cluster_id == clusters.c.id)
        .group_by(clusters.c.id, clusters.c.manual)
        .having(sa.func.count(questions.c.id) < 2)
    ).all()
    for cid, manual in small:
        bind.execute(
            questions.update()
            .where(questions.c.cluster_id == cid)
            .values(cluster_id=None, auto_grouping_disabled=manual)
        )
        bind.execute(clusters.delete().where(clusters.c.id == cid))


def downgrade():
    # Do not recreate the erroneous groups or change question text/resolution/privacy.
    op.drop_column("questions", "auto_grouping_disabled")
