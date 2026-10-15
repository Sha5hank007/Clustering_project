"""
POST /api/auth/login            — login with email + password
GET  /api/auth/me               — get current user info from token
GET  /api/auth/google/login     — redirect to Google OAuth consent
GET  /api/auth/google/callback  — Google redirects here with auth code

No public registration. Superadmins and organization administrators invite users;
invitees choose their own password using a one-time email link.
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
from api.organization_invites import (
    hash_invite_token,
    new_invite_token,
    require_mail_configuration,
    send_password_reset,
)
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


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class ResetPasswordRequest(BaseModel):
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


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest, db=Depends(get_db)):
    generic_response = {"message": "If an eligible account exists for that email, a reset link will be sent."}
    email = body.email.strip().lower()
    cur = db.cursor()
    cur.execute(
        """
        SELECT u.id, u.tenant_id, u.email
        FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE LOWER(u.email) = %s
          AND (u.role = 'superadmin' OR t.is_active = TRUE)
        """,
        (email,),
    )
    account = cur.fetchone()
    if not account:
        return generic_response

    try:
        require_mail_configuration("password_reset")
    except HTTPException:
        logger.exception("Password reset email is unavailable")
        return generic_response

    user_id, tenant_id, account_email = account
    token = new_invite_token()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.password_reset_expiry_hours)
    with db:
        cur.execute(
            """
            UPDATE account_tokens SET revoked_at = now()
            WHERE purpose = 'password_reset' AND user_id = %s
              AND consumed_at IS NULL AND revoked_at IS NULL
            """,
            (user_id,),
        )
        cur.execute(
            """
            INSERT INTO account_tokens (purpose, tenant_id, user_id, email, token_hash, expires_at)
            VALUES ('password_reset', %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (tenant_id, user_id, account_email, hash_invite_token(token), expires_at),
        )
        token_id = cur.fetchone()[0]
    try:
        send_password_reset(account_email, token)
    except HTTPException:
        cur.execute("UPDATE account_tokens SET revoked_at = now() WHERE id = %s", (token_id,))
        db.commit()
        logger.exception("Password reset email delivery failed")
    return generic_response


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, db=Depends(get_db)):
    if len(body.password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be no more than 72 UTF-8 bytes")
    if not re.search(r"[A-Za-z]", body.password) or not re.search(r"\d", body.password):
        raise HTTPException(400, "Password must contain at least one letter and one number")

    cur = db.cursor()
    with db:
        cur.execute(
            """
            SELECT i.id, i.user_id, i.expires_at, u.email, t.is_active, u.tenant_id
            FROM account_tokens i
            JOIN users u ON u.id = i.user_id
            LEFT JOIN tenants t ON t.id = u.tenant_id
            WHERE i.token_hash = %s AND i.purpose = 'password_reset'
              AND i.consumed_at IS NULL AND i.revoked_at IS NULL
            FOR UPDATE OF i, u
            """,
            (hash_invite_token(body.token),),
        )
        reset = cur.fetchone()
        if not reset:
            raise HTTPException(404, "This password reset link is invalid or already used")
        token_id, user_id, expires_at, email, tenant_active, tenant_id = reset
        if expires_at <= datetime.now(timezone.utc):
            raise HTTPException(410, "This password reset link has expired; request another one")
        if tenant_id is not None and not tenant_active:
            raise HTTPException(403, "This organization is inactive")
        cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (bcrypt.hash(body.password), user_id))
        cur.execute("UPDATE account_tokens SET consumed_at = now() WHERE id = %s", (token_id,))
        cur.execute(
            """
            UPDATE account_tokens SET revoked_at = now()
            WHERE purpose = 'password_reset' AND user_id = %s AND id <> %s
              AND consumed_at IS NULL AND revoked_at IS NULL
            """,
            (user_id, token_id),
        )
    logger.info("Password reset completed for user=%d", user_id)
    return {"reset": True, "email": email}


@router.get("/invite-info")
def organization_invite_info(
    token: str = Query(..., min_length=20, max_length=200),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute(
        """
                SELECT i.email, t.name, i.role, i.shop_id, s.name, i.expires_at
                FROM account_tokens i
        JOIN tenants t ON t.id = i.tenant_id
                LEFT JOIN shops s ON s.id = i.shop_id
                WHERE i.token_hash = %s AND i.purpose = 'invite'
                    AND i.consumed_at IS NULL
          AND i.revoked_at IS NULL
          AND i.expires_at > now()
          AND t.is_active = TRUE
        """,
        (hash_invite_token(token),),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "This invitation is invalid, expired, or already used")
    return {
        "email": row[0], "organization_name": row[1], "role": row[2],
        "shop_id": row[3], "shop_name": row[4], "expires_at": row[5].isoformat(),
    }


@router.post("/accept-invite")
def accept_organization_invite(body: AcceptOrganizationInvite, db=Depends(get_db)):
    if len(body.password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be no more than 72 UTF-8 bytes")
    if not re.search(r"[A-Za-z]", body.password) or not re.search(r"\d", body.password):
        raise HTTPException(400, "Password must contain at least one letter and one number")

    cur = db.cursor()
    cur.execute(
        """
                SELECT i.id, i.tenant_id, i.email, i.role, i.shop_id, i.is_first_admin,
                             i.expires_at, t.is_active, s.id
                FROM account_tokens i
        JOIN tenants t ON t.id = i.tenant_id
                LEFT JOIN shops s ON s.id = i.shop_id AND s.tenant_id = i.tenant_id
                WHERE i.token_hash = %s AND i.purpose = 'invite'
                    AND i.consumed_at IS NULL
          AND i.revoked_at IS NULL
        FOR UPDATE OF i, t
        """,
        (hash_invite_token(body.token),),
    )
    invitation = cur.fetchone()
    if not invitation:
        raise HTTPException(404, "This invitation is invalid or already used")

    invite_id, tenant_id, email, role, shop_id, is_first_admin, expires_at, tenant_active, matched_shop_id = invitation
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(410, "This invitation has expired; ask the organization administrator to resend it")
    if not tenant_active:
        raise HTTPException(403, "This organization is inactive")
    if shop_id is not None and matched_shop_id is None:
        raise HTTPException(409, "The assigned shop is no longer available")
    cur.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
    if cur.fetchone():
        raise HTTPException(409, "An account already exists for this email address")

    cur.execute(
        """
        INSERT INTO users (tenant_id, shop_id, email, password_hash, role)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """,
        (tenant_id, shop_id, email, bcrypt.hash(body.password), role),
    )
    user_id = cur.fetchone()[0]
    cur.execute(
        "UPDATE account_tokens SET consumed_at = now() WHERE id = %s",
        (invite_id,),
    )
    if is_first_admin:
        cur.execute(
            """
            INSERT INTO superadmin_audit_events (tenant_id, actor_user_id, action, details)
            VALUES (%s, %s, 'admin_invite.accepted', %s::jsonb)
            """,
            (tenant_id, user_id, json.dumps({"email": email})),
        )
    db.commit()
    logger.info("Account invitation accepted for tenant=%d user=%d role=%s", tenant_id, user_id, role)
    return {"created": True, "email": email, "role": role, "shop_id": shop_id}


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