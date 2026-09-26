"""
Shared dependencies for API endpoints.

Models loaded once at startup.
DB connections per-request.
Auth: JWT token → current user → scope (which data they can see).
"""
import jwt
import psycopg2
from dataclasses import dataclass
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from config import settings
from pipeline.detector import Detector
from pipeline.embedder import Embedder

# ── Database ──

_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")


def get_db():
    conn = psycopg2.connect(_db_url)
    try:
        yield conn
    finally:
        conn.close()


# ── Models (loaded once) ──

_detector = None
_embedder = None


def get_detector() -> Detector:
    global _detector
    if _detector is None:
        _detector = Detector()
    return _detector


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        _embedder = Embedder()
    return _embedder


# ── Auth ──

security = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    """Extracted from JWT token. Available in every protected endpoint."""
    user_id: int
    tenant_id: int
    shop_id: int | None   # None for tenant admins
    role: str             # admin, manager, guard


@dataclass
class Scope:
    """
    Determines what data the current user can see.

    admin:    tenant_id set, shop_id None   → sees all shops under tenant
    manager:  tenant_id set, shop_id set    → sees only their shop
    guard:    tenant_id set, shop_id set    → sees only their shop
    """
    tenant_id: int
    shop_id: int | None

    def sql_filter(self, shop_column: str = "shop_id") -> tuple[str, list]:
        """
        Returns (WHERE clause, params) for scoping queries.

        Usage:
            clause, params = scope.sql_filter("s.shop_id")
            query = "SELECT * FROM sightings s WHERE " + clause
            cur.execute(query, params)
        """
        if self.shop_id:
            # Shop-level: guard or manager
            return "%s = %%s" % shop_column, [self.shop_id]
        else:
            # Tenant-level: admin
            return "%s IN (SELECT id FROM shops WHERE tenant_id = %%s)" % shop_column, [self.tenant_id]


def get_user_from_token(token: str) -> CurrentUser:
    """
    Extract and validate JWT token from Authorization header.
    Every protected endpoint depends on this.

    Header format: Authorization: Bearer <token>
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

    return CurrentUser(
        user_id=payload["user_id"],
        tenant_id=payload["tenant_id"],
        shop_id=payload.get("shop_id"),
        role=payload["role"],
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> CurrentUser:
    """Extract and validate the JWT from the Authorization header."""
    if credentials is None:
        raise HTTPException(401, "Not authenticated")
    return get_user_from_token(credentials.credentials)


def get_current_scope(
    user: CurrentUser = Depends(get_current_user),
) -> Scope:
    """
    Convert current user to a data scope.
    Admin → see all shops. Manager/guard → see their shop only.
    """
    return Scope(
        tenant_id=user.tenant_id,
        shop_id=user.shop_id,
    )


def require_role(*allowed_roles):
    """
    Dependency factory for role-based access control.

    Usage:
        @router.post("/admin/users")
        def create_user(user: CurrentUser = Depends(require_role("admin"))):
            ...

        @router.patch("/persons/{id}/label")
        def update_label(user: CurrentUser = Depends(require_role("admin", "manager"))):
            ...
    """
    def check_role(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed_roles:
            raise HTTPException(403, "Requires role: %s" % ", ".join(allowed_roles))
        return user
    return check_role