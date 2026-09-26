"""
POST   /api/streams              — add live stream (admin picks shop, guard/manager auto-scoped)
GET    /api/streams              — list streams
GET    /api/streams/{id}         — stream detail
PATCH  /api/streams/{id}/pause   — pause
PATCH  /api/streams/{id}/resume  — resume
PATCH  /api/streams/{id}/stop    — stop permanently
DELETE /api/streams/{id}         — stop + delete record
"""
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.deps import (
    get_db, get_current_user, get_current_scope,
    require_role, CurrentUser, Scope,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateStream(BaseModel):
    url: str
    camera_id: str
    name: str | None = None
    shop_id: int | None = None  # required for admin, ignored for guard/manager


def _resolve_shop_id(user: CurrentUser, shop_id: int | None, db) -> int:
    if user.role == "admin":
        if not shop_id:
            raise HTTPException(400, "Admin must specify shop_id")
        cur = db.cursor()
        cur.execute("SELECT id FROM shops WHERE id = %s AND tenant_id = %s", (shop_id, user.tenant_id))
        if not cur.fetchone():
            raise HTTPException(404, "Shop not found in your organization")
        return shop_id
    else:
        if not user.shop_id:
            raise HTTPException(400, "User has no shop assigned")
        return user.shop_id


@router.post("/streams")
def add_stream(
    body: CreateStream,
    user: CurrentUser = Depends(get_current_user),
    db=Depends(get_db),
):
    effective_shop_id = _resolve_shop_id(user, body.shop_id, db)

    if not body.url.startswith(("rtsp://", "webcam://")):
        raise HTTPException(400, "URL must start with rtsp:// or webcam://")

    stream_id = "s_" + uuid.uuid4().hex[:10]
    cur = db.cursor()

    cur.execute(
        "SELECT id FROM live_streams WHERE url = %s AND shop_id = %s AND status != 'stopped'",
        (body.url, effective_shop_id),
    )
    if cur.fetchone():
        raise HTTPException(409, "This stream URL is already active in this shop")

    cur.execute(
        """
        INSERT INTO live_streams (id, shop_id, created_by, url, camera_id, name, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'running')
        """,
        (stream_id, effective_shop_id, user.user_id, body.url, body.camera_id, body.name),
    )
    db.commit()

    logger.info("Stream created: id=%s shop=%d user=%d" % (stream_id, effective_shop_id, user.user_id))
    return {
        "stream_id": stream_id, "status": "running",
        "url": body.url, "camera_id": body.camera_id,
        "name": body.name, "shop_id": effective_shop_id,
    }


@router.get("/streams")
def list_streams(
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    clause, params = scope.sql_filter("ls.shop_id")
    cur.execute(
        """
        SELECT ls.id, ls.camera_id, ls.name, ls.url, ls.status,
               ls.started_at, ls.stopped_at,
               ls.persons_found, ls.sightings_added,
               s.name as shop_name, ls.shop_id
        FROM live_streams ls
        JOIN shops s ON ls.shop_id = s.id
        WHERE %s
        ORDER BY
            CASE WHEN ls.status = 'running' THEN 0
                 WHEN ls.status = 'paused' THEN 1
                 ELSE 2 END,
            ls.started_at DESC
        """ % clause,
        params,
    )
    streams = []
    for row in cur.fetchall():
        streams.append({
            "stream_id": row[0], "camera_id": row[1], "name": row[2],
            "url": row[3], "status": row[4],
            "started_at": row[5].isoformat() if row[5] else None,
            "stopped_at": row[6].isoformat() if row[6] else None,
            "persons_found": row[7], "sightings_added": row[8],
            "shop_name": row[9], "shop_id": row[10],
        })
    return {"streams": streams}


@router.get("/streams/{stream_id}")
def get_stream(
    stream_id: str,
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    clause, params = scope.sql_filter("ls.shop_id")
    cur.execute(
        """
        SELECT ls.id, ls.camera_id, ls.name, ls.url, ls.status,
               ls.started_at, ls.stopped_at,
               ls.persons_found, ls.sightings_added,
               s.name, u.email
        FROM live_streams ls
        JOIN shops s ON ls.shop_id = s.id
        LEFT JOIN users u ON ls.created_by = u.id
        WHERE ls.id = %%s AND %s
        """ % clause,
        [stream_id] + params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Stream not found")
    return {
        "stream_id": row[0], "camera_id": row[1], "name": row[2],
        "url": row[3], "status": row[4],
        "started_at": row[5].isoformat() if row[5] else None,
        "stopped_at": row[6].isoformat() if row[6] else None,
        "persons_found": row[7], "sightings_added": row[8],
        "shop_name": row[9], "created_by": row[10],
    }


@router.patch("/streams/{stream_id}/pause")
def pause_stream(stream_id: str, user: CurrentUser = Depends(get_current_user), scope: Scope = Depends(get_current_scope), db=Depends(get_db)):
    _set_status(stream_id, "paused", "running", scope, user, db)
    return {"stream_id": stream_id, "status": "paused"}


@router.patch("/streams/{stream_id}/resume")
def resume_stream(stream_id: str, user: CurrentUser = Depends(get_current_user), scope: Scope = Depends(get_current_scope), db=Depends(get_db)):
    _set_status(stream_id, "running", "paused", scope, user, db)
    return {"stream_id": stream_id, "status": "running"}


@router.patch("/streams/{stream_id}/stop")
def stop_stream(stream_id: str, user: CurrentUser = Depends(require_role("admin", "manager")), scope: Scope = Depends(get_current_scope), db=Depends(get_db)):
    cur = db.cursor()
    clause, params = scope.sql_filter("shop_id")
    cur.execute("SELECT id, status FROM live_streams WHERE id = %%s AND %s" % clause, [stream_id] + params)
    row = cur.fetchone()
    if not row: raise HTTPException(404, "Stream not found")
    if row[1] == "stopped": raise HTTPException(400, "Already stopped")
    cur.execute("UPDATE live_streams SET status = 'stopped', stopped_at = now() WHERE id = %s", (stream_id,))
    db.commit()
    logger.info("Stream %s stopped by user %d" % (stream_id, user.user_id))
    return {"stream_id": stream_id, "status": "stopped"}


@router.delete("/streams/{stream_id}")
def delete_stream(stream_id: str, user: CurrentUser = Depends(require_role("admin", "manager")), scope: Scope = Depends(get_current_scope), db=Depends(get_db)):
    cur = db.cursor()
    clause, params = scope.sql_filter("shop_id")
    cur.execute("SELECT id, status FROM live_streams WHERE id = %%s AND %s" % clause, [stream_id] + params)
    row = cur.fetchone()
    if not row: raise HTTPException(404, "Stream not found")
    if row[1] in ("running", "paused"):
        cur.execute("UPDATE live_streams SET status = 'stopped', stopped_at = now() WHERE id = %s", (stream_id,))
    cur.execute("SELECT COUNT(*) FROM sightings WHERE stream_id = %s", (stream_id,))
    count = cur.fetchone()[0]
    cur.execute("UPDATE sightings SET stream_id = NULL WHERE stream_id = %s", (stream_id,))
    cur.execute("DELETE FROM live_streams WHERE id = %s", (stream_id,))
    db.commit()
    logger.info("Stream %s deleted by user %d" % (stream_id, user.user_id))
    return {"deleted": True, "stream_id": stream_id, "sightings_unlinked": count}


def _set_status(stream_id, new_status, required_status, scope, user, db):
    cur = db.cursor()
    clause, params = scope.sql_filter("shop_id")
    cur.execute("SELECT id, status FROM live_streams WHERE id = %%s AND %s" % clause, [stream_id] + params)
    row = cur.fetchone()
    if not row: raise HTTPException(404, "Stream not found")
    if row[1] != required_status: raise HTTPException(400, "Can only %s a %s stream (current: %s)" % (new_status, required_status, row[1]))
    cur.execute("UPDATE live_streams SET status = %s WHERE id = %s", (new_status, stream_id))
    db.commit()
    logger.info("Stream %s → %s by user %d" % (stream_id, new_status, user.user_id))