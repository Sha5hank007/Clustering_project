"""optimize sightings job index for pagination

Revision ID: 004
Revises: 003
Create Date: 2026-09-16
"""
from typing import Sequence, Union
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop the old single-column index
    op.execute("DROP INDEX IF EXISTS idx_sightings_job;")
    
    # 2. Create the new composite index (handles exact match on job_id + sorting by seen_at)
    op.execute("CREATE INDEX idx_sightings_job_time ON sightings (job_id, seen_at ASC);")


def downgrade() -> None:
    # 1. Drop the new composite index
    op.execute("DROP INDEX IF EXISTS idx_sightings_job_time;")
    
    # 2. Recreate the old single-column index
    op.execute("CREATE INDEX idx_sightings_job ON sightings (job_id);")