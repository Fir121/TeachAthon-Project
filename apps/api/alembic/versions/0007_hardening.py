"""Folder uniqueness, course-deletion integrity, and backfill of existing sources."""

from alembic import op
import sqlalchemy as s

revision = "0007"
down_revision = "0006"


def upgrade():
    connection = op.get_bind()
    constraints = s.inspect(connection).get_foreign_keys("lectures")
    for fk in constraints:
        if fk["constrained_columns"] == ["slide_resource_id"]:
            op.drop_constraint(fk["name"], "lectures", type_="foreignkey")
    op.create_foreign_key(
        "lectures_deck_fk", "lectures", "resources", ["slide_resource_id"], ["id"], ondelete="CASCADE"
    )
    op.execute("CREATE UNIQUE INDEX unique_folder_sibling ON folders (course_id, coalesce(parent_id, ''), lower(name))")
    op.execute("""INSERT INTO processing_jobs (id,type,course_id,target_id,status,attempts,next_run_at)
        SELECT gen_random_uuid()::text,'index_resource',r.course_id,r.id,'queued',0,now() FROM resources r
        WHERE r.process_status='ready' AND r.indexing_enabled AND NOT EXISTS (SELECT 1 FROM source_chunks c WHERE c.resource_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.target_id=r.id AND j.type='index_resource' AND j.status IN ('queued','processing'))""")


def downgrade():
    op.drop_index("unique_folder_sibling", table_name="folders")
    op.drop_constraint("lectures_deck_fk", "lectures", type_="foreignkey")
    op.create_foreign_key(
        "lectures_deck_fk", "lectures", "resources", ["slide_resource_id"], ["id"], ondelete="RESTRICT"
    )
