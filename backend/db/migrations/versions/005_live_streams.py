"""add live_streams table and stream_id to sightings

Revision ID: 005
Revises: 004
Create Date: 2026-09-17
"""
from typing import Sequence, Union
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── live_streams table ──
    op.execute("""
        CREATE TABLE live_streams (
            id              TEXT PRIMARY KEY,
            shop_id         INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
            created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            url             TEXT NOT NULL,
            camera_id       VARCHAR(100) NOT NULL,
            name            VARCHAR(255),
            status          TEXT NOT NULL DEFAULT 'running',
            started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            stopped_at      TIMESTAMPTZ,
            persons_found   INTEGER DEFAULT 0,
            sightings_added INTEGER DEFAULT 0
        );
    """)

    # Indexes
    op.execute("CREATE INDEX idx_streams_shop ON live_streams(shop_id);")
    op.execute("CREATE INDEX idx_streams_status ON live_streams(status);")

    # ── Add stream_id to sightings ──
    # A sighting comes from either a file upload (job_id) or a live stream (stream_id)
    # Both are nullable, never both set at the same time
    op.execute(
        "ALTER TABLE sightings ADD COLUMN stream_id TEXT REFERENCES live_streams(id) ON DELETE SET NULL;"
    )
    op.execute("CREATE INDEX idx_sightings_stream ON sightings(stream_id);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_sightings_stream;")
    op.execute("ALTER TABLE sightings DROP COLUMN IF EXISTS stream_id;")
    op.execute("DROP INDEX IF EXISTS idx_streams_status;")
    op.execute("DROP INDEX IF EXISTS idx_streams_shop;")
    op.execute("DROP TABLE IF EXISTS live_streams;")