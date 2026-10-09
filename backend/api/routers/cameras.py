"""Shop-scoped camera registry endpoints."""
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.deps import CurrentUser, get_current_user, get_db, require_role

logger = logging.getLogger(__name__)
router = APIRouter()

CAMERA_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


class CreateCamera(BaseModel):
    camera_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    shop_id: int | None = None


class UpdateCamera(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None


def _resolve_shop_id(user: CurrentUser, shop_id: int | None, db) -> int:
    if user.role == "admin":
        if not shop_id:
            raise HTTPException(400, "Admin must specify shop_id")
        cur = db.cursor()
        cur.execute(
            "SELECT id FROM shops WHERE id = %s AND tenant_id = %s",
            (shop_id, user.tenant_id),
        )
        if not cur.fetchone():
            raise HTTPException(404, "Shop not found in your organization")
        return shop_id

    if not user.shop_id:
        raise HTTPException(400, "User has no shop assigned")
    return user.shop_id


@router.get("/cameras")
def list_cameras(
    shop_id: int | None = Query(None),
    include_inactive: bool = Query(False),
    user: CurrentUser = Depends(get_current_user),
    db=Depends(get_db),
):
    effective_shop_id = _resolve_shop_id(user, shop_id, db)
    cur = db.cursor()
    cur.execute(
        """
        SELECT id, camera_id, name, shop_id, is_active, created_at
        FROM cameras
        WHERE shop_id = %s AND (%s OR is_active = TRUE)
        ORDER BY name, camera_id
        """,
        (effective_shop_id, include_inactive and user.role in ("admin", "manager")),
    )
    return {
        "cameras": [
            {
                "id": row[0],
                "camera_id": row[1],
                "name": row[2],
                "shop_id": row[3],
                "is_active": row[4],
                "created_at": row[5].isoformat() if row[5] else None,
            }
            for row in cur.fetchall()
        ]
    }


@router.post("/cameras")
def create_camera(
    body: CreateCamera,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    camera_id = body.camera_id.strip()
    name = body.name.strip()
    if not CAMERA_ID_PATTERN.fullmatch(camera_id):
        raise HTTPException(400, "Camera ID must use letters, numbers, dots, underscores, or hyphens")
    if not name:
        raise HTTPException(400, "Camera name cannot be empty")

    effective_shop_id = _resolve_shop_id(user, body.shop_id, db)
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO cameras (shop_id, camera_id, name)
        VALUES (%s, %s, %s)
        ON CONFLICT (shop_id, camera_id) DO NOTHING
        RETURNING id, camera_id, name, shop_id, is_active
        """,
        (effective_shop_id, camera_id, name),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(409, "A camera with this ID is already registered in this shop")
    db.commit()
    logger.info("Camera registered: id=%s shop=%d by user=%d", camera_id, effective_shop_id, user.user_id)
    return {
        "id": row[0],
        "camera_id": row[1],
        "name": row[2],
        "shop_id": row[3],
        "is_active": row[4],
    }


@router.patch("/cameras/{camera_id}")
def update_camera(
    camera_id: str,
    body: UpdateCamera,
    shop_id: int | None = Query(None),
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db=Depends(get_db),
):
    effective_shop_id = _resolve_shop_id(user, shop_id, db)
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "Provide a camera name or active status to update")
    if "name" in updates:
        updates["name"] = updates["name"].strip()
        if not updates["name"]:
            raise HTTPException(400, "Camera name cannot be empty")

    cur = db.cursor()
    cur.execute(
        """
        UPDATE cameras
        SET name = COALESCE(%s, name),
            is_active = COALESCE(%s, is_active)
        WHERE shop_id = %s AND camera_id = %s
        RETURNING id, camera_id, name, shop_id, is_active
        """,
        (updates.get("name"), updates.get("is_active"), effective_shop_id, camera_id),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Camera not found in this shop")
    db.commit()
    return {
        "id": row[0],
        "camera_id": row[1],
        "name": row[2],
        "shop_id": row[3],
        "is_active": row[4],
    }
