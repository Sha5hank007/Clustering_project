"""
POST /api/auth/login            — login with email + password
GET  /api/auth/me               — get current user info from token
GET  /api/auth/google/login     — redirect to Google OAuth consent
GET  /api/auth/google/callback  — Google redirects here with auth code

No public registration. Superadmins invite organization admins; organization admins
create organization users via /api/admin/users.
Google OAuth only works for users already in the DB (matched by email).
"""
import logging
import json
import re
from datetime import datetime, timedelta, timezone
import jwt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from passlib.hash import bcrypt
from api.deps import get_db, get_current_user, CurrentUser
from api.organization_invites import hash_invite_token
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


class LoginRequest(BaseModel):
    email: str
    password: str


class AcceptOrganizationInvite(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=8, max_length=72)


def _make_jwt(user_id, tenant_id, shop_id, role):
    payload = {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "shop_id": shop_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _login_response(user_id, tenant_id, shop_id, email, role):
    token = _make_jwt(user_id, tenant_id, shop_id, role)
    logger.info("User %s logged in (role=%s, tenant=%s, shop=%s)", email, role, tenant_id, shop_id)
    return {
        "token": token,
        "user_id": user_id,
        "email": email,
        "role": role,
        "tenant_id": tenant_id,
        "shop_id": shop_id,
    }


# ── Email + Password login ──

@router.post("/login")
def login(body: LoginRequest, db=Depends(get_db)):
    cur = db.cursor()
    cur.execute(
        """
        SELECT u.id, u.tenant_id, u.shop_id, u.email, u.password_hash, u.role,
               t.is_active
        FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE LOWER(u.email) = LOWER(%s)
        """,
        (body.email.strip(),),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(401, "Invalid email or password")

    user_id, tenant_id, shop_id, email, password_hash, role, tenant_active = row
    if not bcrypt.verify(body.password, password_hash):
        raise HTTPException(401, "Invalid email or password")
    if role == "superadmin":
        if tenant_id is not None or shop_id is not None:
            raise HTTPException(401, "Invalid email or password")
    elif tenant_id is None or not tenant_active:
        raise HTTPException(401, "Invalid email or password")

    return _login_response(user_id, tenant_id, shop_id, email, role)


@router.get("/invite-info")
def organization_invite_info(
    token: str = Query(..., min_length=20, max_length=200),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute(
        """
        SELECT i.email, t.name, i.expires_at
        FROM organization_admin_invites i
        JOIN tenants t ON t.id = i.tenant_id
        WHERE i.token_hash = %s
          AND i.accepted_at IS NULL
          AND i.revoked_at IS NULL
          AND i.expires_at > now()
          AND t.is_active = TRUE
        """,
        (hash_invite_token(token),),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "This invitation is invalid, expired, or already used")
    return {"email": row[0], "organization_name": row[1], "expires_at": row[2].isoformat()}


@router.post("/accept-invite")
def accept_organization_invite(body: AcceptOrganizationInvite, db=Depends(get_db)):
    if len(body.password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be no more than 72 UTF-8 bytes")
    if not re.search(r"[A-Za-z]", body.password) or not re.search(r"\d", body.password):
        raise HTTPException(400, "Password must contain at least one letter and one number")

    cur = db.cursor()
    cur.execute(
        """
        SELECT i.id, i.tenant_id, i.email, i.expires_at, t.is_active
        FROM organization_admin_invites i
        JOIN tenants t ON t.id = i.tenant_id
        WHERE i.token_hash = %s
          AND i.accepted_at IS NULL
          AND i.revoked_at IS NULL
        FOR UPDATE OF i, t
        """,
        (hash_invite_token(body.token),),
    )
    invitation = cur.fetchone()
    if not invitation:
        raise HTTPException(404, "This invitation is invalid or already used")

    invite_id, tenant_id, email, expires_at, tenant_active = invitation
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(410, "This invitation has expired; ask the organization administrator to resend it")
    if not tenant_active:
        raise HTTPException(403, "This organization is inactive")
    cur.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
    if cur.fetchone():
        raise HTTPException(409, "An account already exists for this email address")

    cur.execute(
        """
        INSERT INTO users (tenant_id, shop_id, email, password_hash, role)
        VALUES (%s, NULL, %s, %s, 'admin')
        RETURNING id
        """,
        (tenant_id, email, bcrypt.hash(body.password)),
    )
    user_id = cur.fetchone()[0]
    cur.execute(
        "UPDATE organization_admin_invites SET accepted_at = now() WHERE id = %s",
        (invite_id,),
    )
    cur.execute(
        """
        INSERT INTO superadmin_audit_events (tenant_id, actor_user_id, action, details)
        VALUES (%s, %s, 'admin_invite.accepted', %s::jsonb)
        """,
        (tenant_id, user_id, json.dumps({"email": email})),
    )
    db.commit()
    logger.info("Organization admin invite accepted for tenant=%d user=%d", tenant_id, user_id)
    return {"created": True, "email": email}


# ── Google OAuth ──

@router.get("/google/login")
def google_login():
    """Redirect user to Google's OAuth consent screen."""
    if not settings.google_client_id:
        raise HTTPException(501, "Google OAuth not configured")

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }
    url = GOOGLE_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url)


@router.get("/google/callback")
def google_callback(code: str = Query(...), db=Depends(get_db)):
    """
    Google redirects here with an auth code.
    Exchange it for user info, look up the email in our DB, issue JWT.
    """
    if not settings.google_client_id:
        raise HTTPException(501, "Google OAuth not configured")

    # 1. Exchange auth code for access token
    token_resp = httpx.post(GOOGLE_TOKEN_URL, data={
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri,
        "grant_type": "authorization_code",
    })
    if token_resp.status_code != 200:
        logger.error("Google token exchange failed: %s", token_resp.text)
        raise HTTPException(400, "Google authentication failed")

    access_token = token_resp.json().get("access_token")

    # 2. Get user info from Google
    userinfo_resp = httpx.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    if userinfo_resp.status_code != 200:
        raise HTTPException(400, "Failed to get Google user info")

    google_email = userinfo_resp.json().get("email", "").lower()
    if not google_email:
        raise HTTPException(400, "No email returned from Google")

    # 3. Look up user in our DB
    cur = db.cursor()
    cur.execute(
        """
        SELECT u.id, u.tenant_id, u.shop_id, u.email, u.role
        FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE LOWER(u.email) = LOWER(%s)
          AND (u.role = 'superadmin' OR t.is_active = TRUE)
        """,
        (google_email,),
    )
    row = cur.fetchone()
    if not row:
        # Redirect to frontend with error — user not in system
        return RedirectResponse(f"{settings.frontend_url}/login?error=no_account")

    user_id, tenant_id, shop_id, email, role = row
    token = _make_jwt(user_id, tenant_id, shop_id, role)
    logger.info("User %s logged in via Google (role=%s)", email, role)

    # 4. Redirect to frontend with token + user info as query params
    params = f"token={token}&user_id={user_id}&email={email}&role={role}&tenant_id={tenant_id or ''}&shop_id={shop_id or ''}"
    return RedirectResponse(f"{settings.frontend_url}/login?{params}")


@router.get("/me")
def get_me(user: CurrentUser = Depends(get_current_user)):
    return {
        "user_id": user.user_id,
        "tenant_id": user.tenant_id,
        "shop_id": user.shop_id,
        "role": user.role,
    }