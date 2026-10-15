"""
Admin endpoints for managing tenants, shops, users, and job control.

POST   /api/admin/shops             — create shop (admin only)
GET    /api/admin/shops             — list shops (admin only)
POST   /api/admin/users/invite      — invite user (admin or manager)
GET    /api/admin/users             — list users (admin or manager)
GET    /api/admin/invitations       — list invitations (admin or manager)
DELETE /api/admin/users/{id}        — delete user (admin or manager)
PATCH  /api/admin/jobs/{id}/control — pause/resume/cancel a job
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.deps import get_db, get_current_user, get_current_scope, require_role, CurrentUser, Scope
from api.organization_invites import (
    hash_invite_token,
    new_invite_token,
    require_mail_configuration,
    send_account_invite,
)
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin")


class CreateShop(BaseModel):
    name: str
    address: str | None = None


class InviteUser(BaseModel):
    email: str
    role: str
    shop_id: int | None = None


class JobControl(BaseModel):
    action: str


# ── Shops ──

@router.post("/shops")
def create_shop(
    body: CreateShop,
    user: CurrentUser = Depends(require_role("admin")),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute(
        "INSERT INTO shops (tenant_id, name, address) VALUES (%s, %s, %s) RETURNING id",
        (user.tenant_id, body.name, body.address),
    )
    shop_id = cur.fetchone()[0]
    db.commit()
    logger.info("Shop created: id=%d name=%s tenant=%d" % (shop_id, body.name, user.tenant_id))
    return {"id": shop_id, "name": body.name, "address": body.address, "tenant_id": user.tenant_id}


@router.get("/shops")
def list_shops(
    user: CurrentUser = Depends(require_role("admin")),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute(
        """
        SELECT s.id, s.name, s.address, s.created_at,
               (SELECT COUNT(*) FROM users u WHERE u.shop_id = s.id) as user_count,
               (SELECT COUNT(*) FROM persons p WHERE p.shop_id = s.id) as person_count,
               (SELECT COUNT(*) FROM ingest_jobs j WHERE j.shop_id = s.id) as job_count,
               (SELECT COUNT(*) FROM live_streams ls WHERE ls.shop_id = s.id AND ls.status = 'running') as active_streams
        FROM shops s WHERE s.tenant_id = %s ORDER BY s.name
        """,
        (user.tenant_id,),
    )
    shops = []
    for row in cur.fetchall():
        shops.append({
            "id": row[0], "name": row[1], "address": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
            "user_count": row[4], "person_count": row[5],
            "job_count": row[6], "active_streams": row[7],
        })
    return {"shops": shops}


# ── Users ──

@router.post("/users/invite", status_code=201)
def invite_user(
    body: InviteUser,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(400, "Enter a valid email address")
    if body.role not in ("admin", "manager", "guard"):
        raise HTTPException(400, "Role must be: admin, manager, or guard")

    if user.role == "manager":
        if body.role == "admin":
            raise HTTPException(403, "Managers cannot create admin users")
        if body.shop_id and body.shop_id != user.shop_id:
            raise HTTPException(403, "Managers can only create users in their own shop")
        body.shop_id = user.shop_id

    if body.role == "admin" and body.shop_id:
        raise HTTPException(400, "Admin users should not be assigned to a shop")

    if body.role in ("manager", "guard") and not body.shop_id:
        raise HTTPException(400, "Manager and guard users must be assigned to a shop")

    cur = db.cursor()

    if body.shop_id:
        cur.execute("SELECT id FROM shops WHERE id = %s AND tenant_id = %s", (body.shop_id, user.tenant_id))
        if not cur.fetchone():
            raise HTTPException(404, "Shop not found in your organization")

    cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
    if cur.fetchone():
        raise HTTPException(409, "An account already exists for this email address")
    cur.execute(
        """
        SELECT id FROM account_tokens
        WHERE purpose = 'invite' AND LOWER(email) = %s
                    AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        """,
        (email,),
    )
    if cur.fetchone():
        raise HTTPException(409, "An active invitation already exists for this email")
    require_mail_configuration()

    shop_name = None
    if body.shop_id:
        cur.execute("SELECT name FROM shops WHERE id = %s", (body.shop_id,))
        shop_name = cur.fetchone()[0]
    token = new_invite_token()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.account_invite_expiry_hours)
    with db:
        cur.execute(
            """
            UPDATE account_tokens SET revoked_at = now()
            WHERE purpose = 'invite' AND LOWER(email) = %s
              AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at <= now()
            """,
            (email,),
        )
        cur.execute(
            """
            INSERT INTO account_tokens
                (purpose, tenant_id, email, role, shop_id, token_hash, expires_at, created_by)
            VALUES ('invite', %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (user.tenant_id, email, body.role, body.shop_id, hash_invite_token(token), expires_at, user.user_id),
        )
        invite_id = cur.fetchone()[0]

    cur.execute("SELECT name FROM tenants WHERE id = %s", (user.tenant_id,))
    tenant_name = cur.fetchone()[0]
    send_account_invite(email, tenant_name, body.role, shop_name, token)
    logger.info("User invited: id=%d email=%s role=%s (by user %d)", invite_id, email, body.role, user.user_id)
    return {"id": invite_id, "email": email, "role": body.role, "shop_id": body.shop_id, "status": "pending"}


@router.get("/invitations")
def list_invitations(
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    cur = db.cursor()
    if user.role == "admin":
        scope_sql = "i.tenant_id = %s"
        scope_params = [user.tenant_id]
    else:
        scope_sql = "i.shop_id = %s"
        scope_params = [user.shop_id]
    cur.execute(
        """
        SELECT i.id, i.email, i.role, i.shop_id, s.name, i.created_at,
               i.expires_at, i.consumed_at, i.revoked_at
        FROM account_tokens i
        LEFT JOIN shops s ON s.id = i.shop_id
        WHERE i.purpose = 'invite' AND %s
        ORDER BY i.created_at DESC, i.id DESC
        """ % scope_sql,
        scope_params,
    )
    now = datetime.now(timezone.utc)
    invitations = []
    for row in cur.fetchall():
        status = "accepted" if row[7] else "revoked" if row[8] else "expired" if row[6] <= now else "pending"
        invitations.append({
            "id": row[0], "email": row[1], "role": row[2], "shop_id": row[3],
            "shop_name": row[4], "created_at": row[5].isoformat() if row[5] else None,
            "expires_at": row[6].isoformat(), "status": status,
        })
    return {"invitations": invitations}


@router.post("/invitations/{invite_id}/resend")
def resend_invitation(
    invite_id: int,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    require_mail_configuration()
    cur = db.cursor()
    if user.role == "admin":
        scope_sql = "i.tenant_id = %s"
        scope_params = [user.tenant_id]
    else:
        scope_sql = "i.shop_id = %s"
        scope_params = [user.shop_id]
    cur.execute(
        """
        SELECT i.email, i.role, i.shop_id, i.tenant_id, t.name, t.is_active, s.name
        FROM account_tokens i
        JOIN tenants t ON t.id = i.tenant_id
        LEFT JOIN shops s ON s.id = i.shop_id
        WHERE i.id = %s AND i.purpose = 'invite' AND %s
          AND i.consumed_at IS NULL AND i.revoked_at IS NULL
        FOR UPDATE OF i
        """ % ("%s", scope_sql),
        [invite_id] + scope_params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Invitation not found")
    email, role, shop_id, tenant_id, tenant_name, tenant_active, shop_name = row
    if not tenant_active:
        raise HTTPException(409, "Reactivate the organization before resending invitations")
    cur.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
    if cur.fetchone():
        raise HTTPException(409, "An account already exists for this email address")

    token = new_invite_token()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.account_invite_expiry_hours)
    with db:
        cur.execute("UPDATE account_tokens SET revoked_at = now() WHERE id = %s", (invite_id,))
        cur.execute(
            """
            INSERT INTO account_tokens
                (purpose, tenant_id, email, role, shop_id, is_first_admin, token_hash, expires_at, created_by)
            VALUES ('invite', %s, %s, %s, %s, FALSE, %s, %s, %s)
            RETURNING id
            """,
            (tenant_id, email, role, shop_id, hash_invite_token(token), expires_at, user.user_id),
        )
        new_id = cur.fetchone()[0]
    send_account_invite(email, tenant_name, role, shop_name, token)
    return {"id": new_id, "email": email, "status": "pending"}


@router.delete("/invitations/{invite_id}")
def revoke_invitation(
    invite_id: int,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    cur = db.cursor()
    if user.role == "admin":
        scope_sql = "tenant_id = %s"
        scope_params = [user.tenant_id]
    else:
        scope_sql = "shop_id = %s"
        scope_params = [user.shop_id]
    cur.execute(
        """
        UPDATE account_tokens SET revoked_at = now()
        WHERE id = %s AND purpose = 'invite' AND %s
          AND consumed_at IS NULL AND revoked_at IS NULL
        RETURNING id
        """ % ("%s", scope_sql),
        [invite_id] + scope_params,
    )
    if not cur.fetchone():
        raise HTTPException(404, "Pending invitation not found")
    db.commit()
    return {"id": invite_id, "status": "revoked"}


@router.get("/users")
def list_users(
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    cur = db.cursor()
    if user.role == "admin":
        cur.execute(
            """
            SELECT u.id, u.email, u.role, u.shop_id, s.name, u.created_at
            FROM users u LEFT JOIN shops s ON u.shop_id = s.id
            WHERE u.tenant_id = %s ORDER BY u.created_at
            """,
            (user.tenant_id,),
        )
    else:
        cur.execute(
            """
            SELECT u.id, u.email, u.role, u.shop_id, s.name, u.created_at
            FROM users u LEFT JOIN shops s ON u.shop_id = s.id
            WHERE u.shop_id = %s ORDER BY u.created_at
            """,
            (user.shop_id,),
        )

    users = []
    for row in cur.fetchall():
        users.append({
            "id": row[0], "email": row[1], "role": row[2],
            "shop_id": row[3], "shop_name": row[4],
            "created_at": row[5].isoformat() if row[5] else None,
        })
    return {"users": users}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    if user_id == user.user_id:
        raise HTTPException(400, "Cannot delete your own account")

    cur = db.cursor()
    if user.role == "admin":
        cur.execute("SELECT id, email, role FROM users WHERE id = %s AND tenant_id = %s", (user_id, user.tenant_id))
    else:
        cur.execute("SELECT id, email, role FROM users WHERE id = %s AND shop_id = %s", (user_id, user.shop_id))

    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    if user.role == "manager" and row[2] == "admin":
        raise HTTPException(403, "Managers cannot delete admin users")

    cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    db.commit()
    logger.info("User deleted: id=%d email=%s (by user %d)" % (user_id, row[1], user.user_id))
    return {"deleted": True, "id": user_id, "email": row[1]}


# ── Job control ──

@router.patch("/jobs/{job_id}/control")
def control_job(
    job_id: str,
    body: JobControl,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    if body.action not in ("pause", "resume", "cancel"):
        raise HTTPException(400, "Action must be: pause, resume, or cancel")

    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute(
        "SELECT id, status FROM ingest_jobs WHERE id = %%s AND %s" % shop_clause,
        [job_id] + shop_params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Job not found")

    current_status = row[1]

    if body.action == "pause":
        if current_status != "processing":
            raise HTTPException(400, "Can only pause a processing job (current: %s)" % current_status)
        cur.execute("UPDATE ingest_jobs SET status = 'paused' WHERE id = %s", (job_id,))

    elif body.action == "resume":
        if current_status not in ("paused", "failed"):
            raise HTTPException(400, "Can only resume paused or failed jobs (current: %s)" % current_status)
        cur.execute("UPDATE ingest_jobs SET status = 'queued' WHERE id = %s", (job_id,))

    elif body.action == "cancel":
        if current_status in ("complete", "cancelled"):
            raise HTTPException(400, "Job already %s" % current_status)
        cur.execute("UPDATE ingest_jobs SET status = 'cancelled' WHERE id = %s", (job_id,))

    db.commit()
    logger.info("Job %s %sd by user %d" % (job_id, body.action, user.user_id))
    return {"job_id": job_id, "action": body.action, "previous_status": current_status}