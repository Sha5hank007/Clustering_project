"""add ingest_jobs table and job_id to sightings

Revision ID: 002
Revises: 001
Create Date: 2026-08-27

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ingest_jobs table ──
    op.execute("""
        CREATE TABLE ingest_jobs (
            id              TEXT PRIMARY KEY,
            original_name   TEXT,
            video_path      TEXT NOT NULL,
            camera_id       TEXT NOT NULL,
            recorded_at     TIMESTAMPTZ NOT NULL,
            fps             DOUBLE PRECISION,
            total_frames    INTEGER,
            processed_frame INTEGER DEFAULT 0,
            status          TEXT NOT NULL DEFAULT 'queued',
            error           TEXT,
            persons_found   INTEGER DEFAULT 0,
            sightings_added INTEGER DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)

    # Index for finding incomplete jobs on restart
    op.execute(
        "CREATE INDEX idx_ingest_jobs_status ON ingest_jobs (status);"
    )

    # ── Add job_id to sightings ──
    op.execute(
        "ALTER TABLE sightings ADD COLUMN job_id TEXT REFERENCES ingest_jobs(id) ON DELETE SET NULL;"
    )

    # Index for fetching all sightings from a specific job
    op.execute(
        "CREATE INDEX idx_sightings_job ON sightings (job_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_sightings_job;")
    op.execute("ALTER TABLE sightings DROP COLUMN IF EXISTS job_id;")
    op.execute("DROP INDEX IF EXISTS idx_ingest_jobs_status;")
    op.execute("DROP TABLE IF EXISTS ingest_jobs;")