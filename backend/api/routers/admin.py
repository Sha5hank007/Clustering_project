"""
Admin endpoints for managing tenants, shops, users, and job control.

POST   /api/admin/tenants           — create tenant (admin only)
POST   /api/admin/shops             — create shop (admin only)
GET    /api/admin/shops             — list shops (admin only)
POST   /api/admin/users             — create user (admin or manager)
GET    /api/admin/users             — list users (admin or manager)
DELETE /api/admin/users/{id}        — delete user (admin or manager)
PATCH  /api/admin/jobs/{id}/control — pause/resume/cancel a job
"""
import logging
from passlib.hash import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.deps import get_db, get_current_user, get_current_scope, require_role, CurrentUser, Scope

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin")


class CreateTenant(BaseModel):
    name: str


class CreateShop(BaseModel):
    name: str
    address: str | None = None


class CreateUser(BaseModel):
    email: str
    password: str
    role: str
    shop_id: int | None = None


class JobControl(BaseModel):
    action: str


# ── Tenants ──

@router.post("/tenants")
def create_tenant(
    body: CreateTenant,
    user: CurrentUser = Depends(require_role("admin")),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute("INSERT INTO tenants (name) VALUES (%s) RETURNING id", (body.name,))
    tenant_id = cur.fetchone()[0]
    db.commit()
    logger.info("Tenant created: id=%d name=%s (by user %d)" % (tenant_id, body.name, user.user_id))
    return {"id": tenant_id, "name": body.name}


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

@router.post("/users")
def create_user(
    body: CreateUser,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
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

    cur.execute("SELECT id FROM users WHERE email = %s", (body.email,))
    if cur.fetchone():
        raise HTTPException(409, "Email already registered")

    password_hash = bcrypt.hash(body.password)
    cur.execute(
        """
        INSERT INTO users (tenant_id, shop_id, email, password_hash, role)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
        """,
        (user.tenant_id, body.shop_id, body.email, password_hash, body.role),
    )
    new_id = cur.fetchone()[0]
    db.commit()
    logger.info("User created: id=%d email=%s role=%s (by user %d)" % (new_id, body.email, body.role, user.user_id))
    return {"id": new_id, "email": body.email, "role": body.role, "shop_id": body.shop_id}


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