"""add tenants, shops, users and multitenant scoping

Revision ID: 003
Revises: 002
Create Date: 2026-09-15
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create hierarchy tables ──
    op.execute("""
        CREATE TABLE tenants (
            id         SERIAL PRIMARY KEY,
            name       VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        );
    """)

    op.execute("""
        CREATE TABLE shops (
            id         SERIAL PRIMARY KEY,
            tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name       VARCHAR(255) NOT NULL,
            address    TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
        );
    """)

    op.execute("""
        CREATE TABLE users (
            id            SERIAL PRIMARY KEY,
            tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            shop_id       INTEGER REFERENCES shops(id) ON DELETE CASCADE,
            email         VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role          VARCHAR(50) NOT NULL,
            created_at    TIMESTAMPTZ DEFAULT now()
        );
    """)

    # ── 2. Create fallback tenant & shop to backfill existing data ──
    op.execute("INSERT INTO tenants (id, name) VALUES (1, 'Default Organization') ON CONFLICT DO NOTHING;")
    op.execute("INSERT INTO shops (id, tenant_id, name) VALUES (1, 1, 'Default Store') ON CONFLICT DO NOTHING;")

    # ── 3. Add scoping columns to existing tables ──
    # shop_id on persons
    op.execute("ALTER TABLE persons ADD COLUMN shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE;")
    op.execute("UPDATE persons SET shop_id = 1 WHERE shop_id IS NULL;")
    op.execute("ALTER TABLE persons ALTER COLUMN shop_id SET NOT NULL;")

    # shop_id on sightings
    op.execute("ALTER TABLE sightings ADD COLUMN shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE;")
    op.execute("UPDATE sightings SET shop_id = 1 WHERE shop_id IS NULL;")
    op.execute("ALTER TABLE sightings ALTER COLUMN shop_id SET NOT NULL;")

    # shop_id and uploaded_by on ingest_jobs
    op.execute("ALTER TABLE ingest_jobs ADD COLUMN shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE;")
    op.execute("UPDATE ingest_jobs SET shop_id = 1 WHERE shop_id IS NULL;")
    op.execute("ALTER TABLE ingest_jobs ALTER COLUMN shop_id SET NOT NULL;")
    
    op.execute("ALTER TABLE ingest_jobs ADD COLUMN uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL;")

    # ── 4. Indexes for fast scoped lookups ──
    op.execute("CREATE INDEX idx_shops_tenant ON shops(tenant_id);")
    op.execute("CREATE INDEX idx_users_shop ON users(shop_id);")
    op.execute("CREATE INDEX idx_users_tenant ON users(tenant_id);")
    op.execute("CREATE INDEX idx_persons_shop ON persons(shop_id);")
    op.execute("CREATE INDEX idx_sightings_shop ON sightings(shop_id);")
    op.execute("CREATE INDEX idx_ingest_jobs_shop ON ingest_jobs(shop_id);")


def downgrade() -> None:
    # Drop added indexes
    op.execute("DROP INDEX IF EXISTS idx_ingest_jobs_shop;")
    op.execute("DROP INDEX IF EXISTS idx_sightings_shop;")
    op.execute("DROP INDEX IF EXISTS idx_persons_shop;")
    op.execute("DROP INDEX IF EXISTS idx_users_tenant;")
    op.execute("DROP INDEX IF EXISTS idx_users_shop;")
    op.execute("DROP INDEX IF EXISTS idx_shops_tenant;")

    # Drop columns from existing tables
    op.execute("ALTER TABLE ingest_jobs DROP COLUMN IF EXISTS uploaded_by;")
    op.execute("ALTER TABLE ingest_jobs DROP COLUMN IF EXISTS shop_id;")
    op.execute("ALTER TABLE sightings DROP COLUMN IF EXISTS shop_id;")
    op.execute("ALTER TABLE persons DROP COLUMN IF EXISTS shop_id;")

    # Drop hierarchy tables
    op.execute("DROP TABLE IF EXISTS users;")
    op.execute("DROP TABLE IF EXISTS shops;")
    op.execute("DROP TABLE IF EXISTS tenants;")