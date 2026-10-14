"""enforce unique normalized organization names and support additional admin invites

Revision ID: 009
Revises: 008
Create Date: 2026-10-14
"""
from typing import Sequence, Union

from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DO $$
        DECLARE duplicate_names TEXT;
        BEGIN
            SELECT string_agg(format('%L (%s)', display_name, organization_ids), ', ')
            INTO duplicate_names
            FROM (
                SELECT MIN(name) AS display_name, string_agg(id::text, ', ' ORDER BY id) AS organization_ids
                FROM tenants
                GROUP BY LOWER(BTRIM(name))
                HAVING COUNT(*) > 1
            ) duplicates;

            IF duplicate_names IS NOT NULL THEN
                RAISE EXCEPTION
                    'Cannot enforce unique organization names. Resolve these existing duplicates first: %',
                    duplicate_names;
            END IF;
        END
        $$;
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_tenants_normalized_name
        ON tenants (LOWER(BTRIM(name)));
    """)
    op.execute("""
        ALTER TABLE organization_admin_invites
        ADD COLUMN is_first_admin BOOLEAN NOT NULL DEFAULT FALSE;
    """)
    op.execute("UPDATE organization_admin_invites SET is_first_admin = TRUE;")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_tenants_normalized_name;")
    op.execute("ALTER TABLE organization_admin_invites DROP COLUMN IF EXISTS is_first_admin;")
