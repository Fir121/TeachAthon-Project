"""Optional private profile pictures and course/lecture banners."""

from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"


def upgrade():
    for table, column in [("users", "avatar_key"), ("courses", "banner_key"), ("lectures", "banner_key")]:
        op.add_column(table, sa.Column(column, sa.String(), nullable=True))


def downgrade():
    for table, column in [("users", "avatar_key"), ("courses", "banner_key"), ("lectures", "banner_key")]:
        op.drop_column(table, column)
