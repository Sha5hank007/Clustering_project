"""Bootstrap the first platform superadmin after applying database migrations."""
import argparse
import getpass
import json
import re
import sys
from pathlib import Path

import psycopg2
from passlib.hash import bcrypt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import settings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--additional",
        action="store_true",
        help="create another trusted platform superadmin after initial bootstrap",
    )
    args = parser.parse_args()

    email = input("Superadmin email: ").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        print("Enter a valid email address.", file=sys.stderr)
        return 1

    password = getpass.getpass("Superadmin password (8+ characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if len(password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1
    if len(password.encode("utf-8")) > 72:
        print("Password must be no more than 72 UTF-8 bytes.", file=sys.stderr)
        return 1
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        print("Password must contain at least one letter and one number.", file=sys.stderr)
        return 1
    if password != confirmation:
        print("Passwords do not match.", file=sys.stderr)
        return 1

    db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    try:
        with psycopg2.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(80412026)")
                cur.execute("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1")
                existing_superadmin = cur.fetchone()
                if existing_superadmin and not args.additional:
                    print("A superadmin already exists; bootstrap is one-time only.", file=sys.stderr)
                    return 1
                cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
                if cur.fetchone():
                    print("An account with this email already exists.", file=sys.stderr)
                    return 1
                cur.execute(
                    """
                    INSERT INTO users (tenant_id, shop_id, email, password_hash, role)
                    VALUES (NULL, NULL, %s, %s, 'superadmin')
                    RETURNING id
                    """,
                    (email, bcrypt.hash(password)),
                )
                user_id = cur.fetchone()[0]
                cur.execute(
                    """
                    INSERT INTO superadmin_audit_events (actor_user_id, action, details)
                    VALUES (%s, %s, %s::jsonb)
                    """,
                    (
                        user_id,
                        "superadmin.created" if existing_superadmin else "superadmin.bootstrapped",
                        json.dumps({"email": email}),
                    ),
                )
    except psycopg2.Error as exc:
        print("Unable to create superadmin: %s" % exc, file=sys.stderr)
        return 1

    print("Superadmin created: id=%d email=%s" % (user_id, email))
    print("Sign in at the FaceTrack frontend to provision organizations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
