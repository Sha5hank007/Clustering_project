"""add superadmin organization provisioning and admin invitations

Revision ID: 008
Revises: 007
Create Date: 2026-10-12
"""
from typing import Sequence, Union

from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE tenants ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;")
    op.execute("ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;")
    op.execute("""
        ALTER TABLE users
        ADD CONSTRAINT ck_users_role_tenant_scope
        CHECK (
            (role = 'superadmin' AND tenant_id IS NULL AND shop_id IS NULL)
            OR (role <> 'superadmin' AND tenant_id IS NOT NULL)
        );
    """)
    op.execute("""
        CREATE TABLE organization_admin_invites (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            accepted_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_pending_org_admin_invite_email
        ON organization_admin_invites (LOWER(email))
        WHERE accepted_at IS NULL AND revoked_at IS NULL;
    """)
    op.execute("CREATE INDEX idx_org_admin_invites_tenant ON organization_admin_invites(tenant_id);")
    op.execute("""
        CREATE TABLE superadmin_audit_events (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(80) NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("CREATE INDEX idx_superadmin_audit_created ON superadmin_audit_events(created_at DESC);")


def downgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM users WHERE role = 'superadmin') THEN
                RAISE EXCEPTION 'Remove superadmin accounts before downgrading revision 008';
            END IF;
        END
        $$;
    """)
    op.execute("DROP TABLE IF EXISTS superadmin_audit_events;")
    op.execute("DROP TABLE IF EXISTS organization_admin_invites;")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role_tenant_scope;")
    op.execute("ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;")
    op.execute("ALTER TABLE tenants DROP COLUMN IF EXISTS is_active;")
