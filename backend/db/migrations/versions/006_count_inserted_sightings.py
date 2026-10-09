"""count inserted sightings rather than matched tracks

Revision ID: 006
Revises: 005
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE persons p
        SET sighting_count = (
            SELECT COUNT(*)
            FROM sightings s
            WHERE s.person_id = p.id
        );
    """)
    op.execute("ALTER TABLE persons ALTER COLUMN sighting_count SET DEFAULT 0;")


def downgrade() -> None:
    op.execute("ALTER TABLE persons ALTER COLUMN sighting_count SET DEFAULT 1;")
