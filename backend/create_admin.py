"""
Create the initial admin user.
Run once after setup: python create_admin.py

Creates admin under the default tenant (id=1) created by migration 003.
"""
import sys
import psycopg2
from passlib.hash import bcrypt
from config import settings

db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

email = input("Admin email: ").strip()
if not email:
    print("Email cannot be empty")
    sys.exit(1)

password = input("Admin password: ").strip()
if len(password) < 6:
    print("Password must be at least 6 characters")
    sys.exit(1)

password_hash = bcrypt.hash(password)

conn = psycopg2.connect(db_url)
cur = conn.cursor()

# Check if email already exists
cur.execute("SELECT id FROM users WHERE email = %s", (email,))
if cur.fetchone():
    print("User with this email already exists")
    conn.close()
    sys.exit(1)

# Ensure default tenant exists
cur.execute("SELECT id FROM tenants WHERE id = 1")
if not cur.fetchone():
    cur.execute("INSERT INTO tenants (id, name) VALUES (1, 'Default Organization')")

cur.execute(
    """
    INSERT INTO users (tenant_id, shop_id, email, password_hash, role)
    VALUES (1, NULL, %s, %s, 'admin')
    RETURNING id
    """,
    (email, password_hash),
)
user_id = cur.fetchone()[0]
conn.commit()
conn.close()

print("Admin created: id=%d email=%s" % (user_id, email))
print("Login with: POST /api/auth/login")