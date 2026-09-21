"""
POST /api/auth/login     — login, get JWT token
GET  /api/auth/me        — get current user info from token

No public registration. Admin creates users via /api/admin/users.
"""
import logging
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from passlib.hash import bcrypt
from api.deps import get_db, get_current_user, CurrentUser
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth")


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginRequest, db=Depends(get_db)):
    """
    Authenticate with email + password.
    Returns JWT token containing user_id, tenant_id, shop_id, role.
    """
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

    payload = {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "shop_id": shop_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    logger.info("User %s logged in (role=%s, tenant=%d, shop=%s)" % (email, role, tenant_id, shop_id))

    return {
        "token": token,
        "user_id": user_id,
        "email": email,
        "role": role,
        "tenant_id": tenant_id,
        "shop_id": shop_id,
    }


@router.get("/me")
def get_me(user: CurrentUser = Depends(get_current_user)):
    """Return current user info from JWT token."""
    return {
        "user_id": user.user_id,
        "tenant_id": user.tenant_id,
        "shop_id": user.shop_id,
        "role": user.role,
    }