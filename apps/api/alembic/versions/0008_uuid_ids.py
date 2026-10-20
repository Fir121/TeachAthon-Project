"""Use native PostgreSQL UUIDs for all identity and tenant foreign keys."""

from alembic import op
import sqlalchemy as s
from sqlalchemy.dialects.postgresql import UUID

revision = "0008"
down_revision = "0007"


def convert(to_uuid):
    inspector = s.inspect(op.get_bind())
    tables = inspector.get_table_names()
    keys = [(table, fk) for table in tables for fk in inspector.get_foreign_keys(table)]
    columns = [
        (table, col)
        for table in tables
        for col in inspector.get_columns(table)
        if (isinstance(col["type"], s.String) and col["type"].length == 36)
        if to_uuid
    ]
    if not to_uuid:
        columns = [
            (table, col) for table in tables for col in inspector.get_columns(table) if isinstance(col["type"], UUID)
        ]
    op.drop_index("unique_folder_sibling", table_name="folders")
    for table, fk in keys:
        op.drop_constraint(fk["name"], table, type_="foreignkey")
    for table, col in columns:
        name = col["name"]
        op.alter_column(
            table,
            name,
            type_=UUID(as_uuid=False) if to_uuid else s.String(36),
            postgresql_using=f'"{name}"::uuid' if to_uuid else f'"{name}"::text',
        )
    for table, fk in keys:
        op.create_foreign_key(
            fk["name"],
            table,
            fk["referred_table"],
            fk["constrained_columns"],
            fk["referred_columns"],
            **fk.get("options", {}),
        )
    expression = (
        "coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)" if to_uuid else "coalesce(parent_id, '')"
    )
    op.execute(f"CREATE UNIQUE INDEX unique_folder_sibling ON folders (course_id, {expression}, lower(name))")


def upgrade():
    convert(True)


def downgrade():
    convert(False)
