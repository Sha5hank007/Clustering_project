"""register cameras per shop and enforce camera ownership

Revision ID: 007
Revises: 006
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE cameras (
            id SERIAL PRIMARY KEY,
            shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
            camera_id VARCHAR(100) NOT NULL,
            name VARCHAR(255) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_cameras_shop_camera UNIQUE (shop_id, camera_id)
        );
    """)
    op.execute("""
        INSERT INTO cameras (shop_id, camera_id, name)
        SELECT shop_id, camera_id, camera_id
        FROM (
            SELECT shop_id, camera_id FROM sightings
            UNION
            SELECT shop_id, camera_id FROM ingest_jobs
            UNION
            SELECT shop_id, camera_id FROM live_streams
        ) existing_cameras
        ON CONFLICT (shop_id, camera_id) DO NOTHING;
    """)
    op.execute("""
        ALTER TABLE sightings
        ADD CONSTRAINT fk_sightings_shop_camera
        FOREIGN KEY (shop_id, camera_id)
        REFERENCES cameras (shop_id, camera_id);
    """)
    op.execute("""
        ALTER TABLE ingest_jobs
        ADD CONSTRAINT fk_ingest_jobs_shop_camera
        FOREIGN KEY (shop_id, camera_id)
        REFERENCES cameras (shop_id, camera_id);
    """)
    op.execute("""
        ALTER TABLE live_streams
        ADD CONSTRAINT fk_live_streams_shop_camera
        FOREIGN KEY (shop_id, camera_id)
        REFERENCES cameras (shop_id, camera_id);
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE live_streams DROP CONSTRAINT IF EXISTS fk_live_streams_shop_camera;")
    op.execute("ALTER TABLE ingest_jobs DROP CONSTRAINT IF EXISTS fk_ingest_jobs_shop_camera;")
    op.execute("ALTER TABLE sightings DROP CONSTRAINT IF EXISTS fk_sightings_shop_camera;")
    op.execute("DROP TABLE IF EXISTS cameras;")
