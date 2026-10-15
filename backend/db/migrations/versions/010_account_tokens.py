"""Unify account invitations and password reset tokens.

Revision ID: 010
Revises: 009
Create Date: 2026-10-15
"""
from typing import Sequence, Union

from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE account_tokens (
            id SERIAL PRIMARY KEY,
            purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('invite', 'password_reset')),
            tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(32),
            shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL,
            is_first_admin BOOLEAN NOT NULL DEFAULT FALSE,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_account_tokens_context CHECK (
                (purpose = 'invite' AND tenant_id IS NOT NULL AND user_id IS NULL AND role IS NOT NULL)
                OR (purpose = 'password_reset' AND user_id IS NOT NULL)
            )
        );
    """)
    op.execute("""
        INSERT INTO account_tokens
            (purpose, tenant_id, email, role, is_first_admin, token_hash, expires_at,
             consumed_at, revoked_at, created_by, created_at)
        SELECT 'invite', tenant_id, email, 'admin', is_first_admin, token_hash, expires_at,
               accepted_at, revoked_at, created_by, created_at
        FROM organization_admin_invites;
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_pending_account_invite_email
        ON account_tokens (LOWER(email))
        WHERE purpose = 'invite' AND consumed_at IS NULL AND revoked_at IS NULL;
    """)
    op.execute("CREATE INDEX idx_account_tokens_tenant ON account_tokens(tenant_id, created_at DESC);")
    op.execute("CREATE INDEX idx_account_tokens_user ON account_tokens(user_id, created_at DESC);")
    op.execute("DROP TABLE organization_admin_invites;")


def downgrade() -> None:
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
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            is_first_admin BOOLEAN NOT NULL DEFAULT FALSE
        );
    """)
    op.execute("""
        INSERT INTO organization_admin_invites
            (tenant_id, email, token_hash, expires_at, accepted_at, revoked_at,
             created_by, created_at, is_first_admin)
        SELECT tenant_id, email, token_hash, expires_at, consumed_at, revoked_at,
               created_by, created_at, is_first_admin
        FROM account_tokens
        WHERE purpose = 'invite';
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_pending_org_admin_invite_email
        ON organization_admin_invites (LOWER(email))
        WHERE accepted_at IS NULL AND revoked_at IS NULL;
    """)
    op.execute("CREATE INDEX idx_org_admin_invites_tenant ON organization_admin_invites(tenant_id);")
    op.execute("DROP TABLE account_tokens;")
