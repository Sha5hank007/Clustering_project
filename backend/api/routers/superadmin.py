"""Platform-level organization provisioning and status management."""
import logging
import json
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from psycopg2.errors import UniqueViolation

from api.deps import CurrentUser, get_db, require_role
from api.organization_invites import (
    hash_invite_token,
    new_invite_token,
    require_mail_configuration,
    send_admin_invite,
)
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/superadmin")

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _record_audit(cur, tenant_id: int | None, actor_user_id: int, action: str, details: dict) -> None:
    cur.execute(
        """
        INSERT INTO superadmin_audit_events (tenant_id, actor_user_id, action, details)
        VALUES (%s, %s, %s, %s::jsonb)
        """,
        (tenant_id, actor_user_id, action, json.dumps(details)),
    )


class CreateOrganization(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    admin_email: str = Field(min_length=3, max_length=255)


class OrganizationStatus(BaseModel):
    is_active: bool


@router.get("/organizations")
def list_organizations(
    user: CurrentUser = Depends(require_role("superadmin")),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute(
        """
        SELECT t.id, t.name, t.is_active, t.created_at,
               (SELECT COUNT(*) FROM shops s WHERE s.tenant_id = t.id),
               (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id),
               latest.email, latest.accepted_at, latest.expires_at, latest.revoked_at
        FROM tenants t
        LEFT JOIN LATERAL (
            SELECT i.email, i.accepted_at, i.expires_at, i.revoked_at
            FROM organization_admin_invites i
            WHERE i.tenant_id = t.id
            ORDER BY i.created_at DESC, i.id DESC
            LIMIT 1
        ) latest ON TRUE
        ORDER BY t.created_at DESC, t.id DESC
        """
    )
    now = datetime.now(timezone.utc)
    organizations = []
    for row in cur.fetchall():
        if not row[6]:
            invite_status = "not_invited"
        elif row[7]:
            invite_status = "accepted"
        elif row[9]:
            invite_status = "revoked"
        elif row[8] <= now:
            invite_status = "expired"
        else:
            invite_status = "pending"
        organizations.append({
            "id": row[0],
            "name": row[1],
            "is_active": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
            "shop_count": row[4],
            "user_count": row[5],
            "admin_email": row[6],
            "admin_invite_status": invite_status,
            "admin_invite_expires_at": row[8].isoformat() if row[8] else None,
        })
    return {"organizations": organizations}


@router.get("/audit")
def list_audit_events(
    limit: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(require_role("superadmin")),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute(
        """
        SELECT a.id, a.tenant_id, t.name, a.actor_user_id, u.email,
               a.action, a.details, a.created_at
        FROM superadmin_audit_events a
        LEFT JOIN tenants t ON t.id = a.tenant_id
        LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT %s
        """,
        (limit,),
    )
    events = []
    for row in cur.fetchall():
        events.append({
            "id": row[0],
            "tenant_id": row[1],
            "organization_name": row[2],
            "actor_user_id": row[3],
            "actor_email": row[4],
            "action": row[5],
            "details": row[6],
            "created_at": row[7].isoformat() if row[7] else None,
        })
    return {"events": events}


@router.post("/organizations", status_code=201)
def create_organization(
    body: CreateOrganization,
    user: CurrentUser = Depends(require_role("superadmin")),
    db=Depends(get_db),
):
    name = body.name.strip()
    email = body.admin_email.strip().lower()
    if not name:
        raise HTTPException(400, "Organization name is required")
    if not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(400, "Enter a valid admin email address")
    require_mail_configuration()

    cur = db.cursor()
    cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
    if cur.fetchone():
        raise HTTPException(409, "An account already exists for this email address")
    cur.execute(
        """
        SELECT id FROM organization_admin_invites
        WHERE LOWER(email) = %s
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        """,
        (email,),
    )
    if cur.fetchone():
        raise HTTPException(409, "An active organization invitation already exists for this email")

    token = new_invite_token()
    try:
        with db:
            cur.execute(
                """
                UPDATE organization_admin_invites
                SET revoked_at = now()
                WHERE LOWER(email) = %s
                  AND accepted_at IS NULL
                  AND revoked_at IS NULL
                  AND expires_at <= now()
                """,
                (email,),
            )
            cur.execute("INSERT INTO tenants (name) VALUES (%s) RETURNING id", (name,))
            tenant_id = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO organization_admin_invites
                    (tenant_id, email, token_hash, expires_at, created_by)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    tenant_id,
                    email,
                    hash_invite_token(token),
                    datetime.now(timezone.utc) + timedelta(hours=settings.organization_invite_expiry_hours),
                    user.user_id,
                ),
            )
            _record_audit(
                cur,
                tenant_id,
                user.user_id,
                "organization.created",
                {"organization_name": name, "admin_email": email},
            )
    except UniqueViolation as exc:
        raise HTTPException(409, "An active organization invitation already exists for this email") from exc

    send_admin_invite(email, name, token)
    logger.info(
        "Organization created: id=%d by superadmin user=%d; first admin invited",
        tenant_id,
        user.user_id,
    )
    return {
        "id": tenant_id,
        "name": name,
        "admin_email": email,
        "admin_invite_status": "pending",
    }


@router.post("/organizations/{tenant_id}/resend-invite")
def resend_admin_invite(
    tenant_id: int,
    user: CurrentUser = Depends(require_role("superadmin")),
    db=Depends(get_db),
):
    require_mail_configuration()
    cur = db.cursor()
    cur.execute("SELECT name, is_active FROM tenants WHERE id = %s FOR UPDATE", (tenant_id,))
    tenant = cur.fetchone()
    if not tenant:
        raise HTTPException(404, "Organization not found")
    if not tenant[1]:
        raise HTTPException(409, "Reactivate the organization before sending an admin invitation")

    cur.execute(
        """
        SELECT email FROM organization_admin_invites
        WHERE tenant_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (tenant_id,),
    )
    latest = cur.fetchone()
    if not latest:
        raise HTTPException(404, "No first-admin invitation exists for this organization")
    email = latest[0]
    cur.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
    if cur.fetchone():
        raise HTTPException(409, "The invited admin already has an account")
    cur.execute(
        """
        SELECT id FROM organization_admin_invites
        WHERE LOWER(email) = LOWER(%s)
          AND tenant_id <> %s
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        """,
        (email, tenant_id),
    )
    if cur.fetchone():
        raise HTTPException(409, "This email already has an active invitation for another organization")

    token = new_invite_token()
    try:
        with db:
            cur.execute(
                """
                UPDATE organization_admin_invites
                SET revoked_at = now()
                WHERE tenant_id = %s AND accepted_at IS NULL AND revoked_at IS NULL
                """,
                (tenant_id,),
            )
            cur.execute(
                """
                INSERT INTO organization_admin_invites
                    (tenant_id, email, token_hash, expires_at, created_by)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    tenant_id,
                    email,
                    hash_invite_token(token),
                    datetime.now(timezone.utc) + timedelta(hours=settings.organization_invite_expiry_hours),
                    user.user_id,
                ),
            )
            _record_audit(
                cur,
                tenant_id,
                user.user_id,
                "admin_invite.resent",
                {"admin_email": email},
            )
    except UniqueViolation as exc:
        raise HTTPException(409, "This email already has an active invitation for another organization") from exc

    send_admin_invite(email, tenant[0], token)
    logger.info("Organization admin invite resent: tenant=%d by superadmin=%d", tenant_id, user.user_id)
    return {"tenant_id": tenant_id, "admin_email": email, "admin_invite_status": "pending"}


@router.patch("/organizations/{tenant_id}/status")
def set_organization_status(
    tenant_id: int,
    body: OrganizationStatus,
    user: CurrentUser = Depends(require_role("superadmin")),
    db=Depends(get_db),
):
    cur = db.cursor()
    with db:
        cur.execute(
            "UPDATE tenants SET is_active = %s WHERE id = %s RETURNING id, name, is_active",
            (body.is_active, tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Organization not found")
        _record_audit(
            cur,
            tenant_id,
            user.user_id,
            "organization.status_changed",
            {"is_active": body.is_active},
        )
    logger.warning(
        "Organization %d status changed to %s by superadmin user %d",
        tenant_id,
        "active" if body.is_active else "suspended",
        user.user_id,
    )
    return {"id": row[0], "name": row[1], "is_active": row[2]}
