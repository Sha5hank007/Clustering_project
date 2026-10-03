"""
POST /api/auth/login            — login with email + password
GET  /api/auth/me               — get current user info from token
GET  /api/auth/google/login     — redirect to Google OAuth consent
GET  /api/auth/google/callback  — Google redirects here with auth code

No public registration. Admin creates users via /api/admin/users.
Google OAuth only works for users already in the DB (matched by email).
"""
import logging
from datetime import datetime, timedelta, timezone
import jwt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from passlib.hash import bcrypt
from api.deps import get_db, get_current_user, CurrentUser
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


class LoginRequest(BaseModel):
    email: str
    password: str


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
    logger.info("User %s logged in (role=%s, tenant=%d, shop=%s)", email, role, tenant_id, shop_id)
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
        "SELECT id, tenant_id, shop_id, email, password_hash, role FROM users WHERE email = %s",
        (body.email,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(401, "Invalid email or password")

    user_id, tenant_id, shop_id, email, password_hash, role = row
    if not bcrypt.verify(body.password, password_hash):
        raise HTTPException(401, "Invalid email or password")

    return _login_response(user_id, tenant_id, shop_id, email, role)


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
        "SELECT id, tenant_id, shop_id, email, role FROM users WHERE email = %s",
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
    params = f"token={token}&user_id={user_id}&email={email}&role={role}&tenant_id={tenant_id}&shop_id={shop_id or ''}"
    return RedirectResponse(f"{settings.frontend_url}/login?{params}")


@router.get("/me")
def get_me(user: CurrentUser = Depends(get_current_user)):
    return {
        "user_id": user.user_id,
        "tenant_id": user.tenant_id,
        "shop_id": user.shop_id,
        "role": user.role,
    }