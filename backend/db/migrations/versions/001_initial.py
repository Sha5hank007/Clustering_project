"""create persons and sightings tables

Revision ID: 001
Revises:
Create Date: 2026-08-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enable pgvector
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    # 2. Create persons table
    op.execute("""
        CREATE TABLE persons (
            id              SERIAL PRIMARY KEY,
            centroid        vector(512)     NOT NULL,
            embedding_count INTEGER         NOT NULL DEFAULT 1,
            sighting_count  INTEGER         NOT NULL DEFAULT 1,
            first_seen      TIMESTAMPTZ     NOT NULL DEFAULT now(),
            last_seen       TIMESTAMPTZ     NOT NULL DEFAULT now(),
            label           TEXT,
            model_version   VARCHAR(50)     NOT NULL DEFAULT 'w600k_r50'
        );
    """)

    # 3. Create sightings table
    op.execute("""
        CREATE TABLE sightings (
            id              SERIAL PRIMARY KEY,
            person_id       INTEGER         NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
            camera_id       VARCHAR(100)    NOT NULL,
            seen_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
            quality_score   DOUBLE PRECISION,
            embedding       vector(512),
            crop_path       TEXT,
            bbox            JSONB
        );
    """)

    # 4. Indexes
    op.execute("CREATE INDEX idx_sightings_person_time ON sightings (person_id, seen_at DESC);")
    op.execute("CREATE INDEX idx_sightings_crops ON sightings (person_id, seen_at) WHERE crop_path IS NOT NULL;")
    op.execute("CREATE INDEX idx_sightings_cooldown ON sightings (person_id, camera_id, seen_at DESC);")


def downgrade() -> None:
    # Drop tables and extensions in reverse order if you need to rollback
    op.execute("DROP INDEX IF EXISTS idx_sightings_cooldown;")
    op.execute("DROP INDEX IF EXISTS idx_sightings_crops;")
    op.execute("DROP INDEX IF EXISTS idx_sightings_person_time;")
    op.execute("DROP TABLE IF EXISTS sightings;")
    op.execute("DROP TABLE IF EXISTS persons;")
    op.execute("DROP EXTENSION IF EXISTS vector;")
