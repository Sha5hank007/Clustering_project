"""
POST   /api/streams              — add a live stream
GET    /api/streams              — list streams for user's scope
GET    /api/streams/{id}         — stream detail + stats
PATCH  /api/streams/{id}/pause   — pause processing
PATCH  /api/streams/{id}/resume  — resume processing
PATCH  /api/streams/{id}/stop    — stop permanently
DELETE /api/streams/{id}         — stop + delete stream and its sightings
"""
import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.deps import (
    get_db, get_current_user, get_current_scope,
    require_role, CurrentUser, Scope,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateStream(BaseModel):
    url: str                    # rtsp://admin:pass@192.168.1.100:554/stream
    camera_id: str              # logical name: "entrance_cam"
    name: str | None = None     # display name: "Front Entrance Live"


# ── Create ──

@router.post("/streams")
def add_stream(
    body: CreateStream,
    user: CurrentUser = Depends(get_current_user),
    db=Depends(get_db),
):
    if not user.shop_id:
        raise HTTPException(400, "Admin must specify a shop. Assign yourself to a shop or use a shop-level account.")

    if not body.url.startswith("rtsp://"):
        raise HTTPException(400, "URL must start with rtsp://")

    stream_id = "s_" + uuid.uuid4().hex[:10]

    cur = db.cursor()

    # Check for duplicate URL in same shop
    cur.execute(
        "SELECT id FROM live_streams WHERE url = %s AND shop_id = %s AND status != 'stopped'",
        (body.url, user.shop_id),
    )
    if cur.fetchone():
        raise HTTPException(409, "This stream URL is already active in this shop")

    cur.execute(
        """
        INSERT INTO live_streams (id, shop_id, created_by, url, camera_id, name, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'running')
        """,
        (stream_id, user.shop_id, user.user_id, body.url, body.camera_id, body.name),
    )
    db.commit()

    logger.info("Stream created: id=%s camera=%s shop=%d (by user %d)" % (
        stream_id, body.camera_id, user.shop_id, user.user_id))

    return {
        "stream_id": stream_id,
        "status": "running",
        "url": body.url,
        "camera_id": body.camera_id,
        "name": body.name,
    }


# ── List ──

@router.get("/streams")
def list_streams(
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("ls.shop_id")

    cur.execute(
        """
        SELECT ls.id, ls.camera_id, ls.name, ls.url, ls.status,
               ls.started_at, ls.stopped_at,
               ls.persons_found, ls.sightings_added,
               s.name as shop_name
        FROM live_streams ls
        JOIN shops s ON ls.shop_id = s.id
        WHERE %s
        ORDER BY
            CASE WHEN ls.status = 'running' THEN 0
                 WHEN ls.status = 'paused' THEN 1
                 ELSE 2 END,
            ls.started_at DESC
        """ % shop_clause,
        shop_params,
    )

    streams = []
    for row in cur.fetchall():
        streams.append({
            "stream_id": row[0], "camera_id": row[1], "name": row[2],
            "url": row[3], "status": row[4],
            "started_at": row[5].isoformat() if row[5] else None,
            "stopped_at": row[6].isoformat() if row[6] else None,
            "persons_found": row[7], "sightings_added": row[8],
            "shop_name": row[9],
        })
    return {"streams": streams}


# ── Detail ──

@router.get("/streams/{stream_id}")
def get_stream(
    stream_id: str,
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("ls.shop_id")

    cur.execute(
        """
        SELECT ls.id, ls.camera_id, ls.name, ls.url, ls.status,
               ls.started_at, ls.stopped_at,
               ls.persons_found, ls.sightings_added,
               s.name as shop_name,
               u.email as created_by_email
        FROM live_streams ls
        JOIN shops s ON ls.shop_id = s.id
        LEFT JOIN users u ON ls.created_by = u.id
        WHERE ls.id = %%s AND %s
        """ % shop_clause,
        [stream_id] + shop_params,
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


# ── Control ──

@router.patch("/streams/{stream_id}/pause")
def pause_stream(
    stream_id: str,
    user: CurrentUser = Depends(require_role("admin", "manager", "guard")),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute(
        "SELECT id, status FROM live_streams WHERE id = %%s AND %s" % shop_clause,
        [stream_id] + shop_params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Stream not found")
    if row[1] != "running":
        raise HTTPException(400, "Can only pause a running stream (current: %s)" % row[1])

    cur.execute("UPDATE live_streams SET status = 'paused' WHERE id = %s", (stream_id,))
    db.commit()
    logger.info("Stream %s paused by user %d" % (stream_id, user.user_id))
    return {"stream_id": stream_id, "status": "paused"}


@router.patch("/streams/{stream_id}/resume")
def resume_stream(
    stream_id: str,
    user: CurrentUser = Depends(require_role("admin", "manager", "guard")),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute(
        "SELECT id, status FROM live_streams WHERE id = %%s AND %s" % shop_clause,
        [stream_id] + shop_params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Stream not found")
    if row[1] != "paused":
        raise HTTPException(400, "Can only resume a paused stream (current: %s)" % row[1])

    cur.execute("UPDATE live_streams SET status = 'running' WHERE id = %s", (stream_id,))
    db.commit()
    logger.info("Stream %s resumed by user %d" % (stream_id, user.user_id))
    return {"stream_id": stream_id, "status": "running"}


@router.patch("/streams/{stream_id}/stop")
def stop_stream(
    stream_id: str,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute(
        "SELECT id, status FROM live_streams WHERE id = %%s AND %s" % shop_clause,
        [stream_id] + shop_params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Stream not found")
    if row[1] == "stopped":
        raise HTTPException(400, "Stream is already stopped")

    cur.execute(
        "UPDATE live_streams SET status = 'stopped', stopped_at = now() WHERE id = %s",
        (stream_id,),
    )
    db.commit()
    logger.info("Stream %s stopped by user %d" % (stream_id, user.user_id))
    return {"stream_id": stream_id, "status": "stopped"}


# ── Delete ──

@router.delete("/streams/{stream_id}")
def delete_stream(
    stream_id: str,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute(
        "SELECT id, status FROM live_streams WHERE id = %%s AND %s" % shop_clause,
        [stream_id] + shop_params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Stream not found")

    # Stop first if running
    if row[1] in ("running", "paused"):
        cur.execute(
            "UPDATE live_streams SET status = 'stopped', stopped_at = now() WHERE id = %s",
            (stream_id,),
        )

    # Count sightings that will be orphaned
    cur.execute("SELECT COUNT(*) FROM sightings WHERE stream_id = %s", (stream_id,))
    sighting_count = cur.fetchone()[0]

    # Nullify stream_id on sightings (don't delete the sightings themselves)
    cur.execute("UPDATE sightings SET stream_id = NULL WHERE stream_id = %s", (stream_id,))

    # Delete the stream record
    cur.execute("DELETE FROM live_streams WHERE id = %s", (stream_id,))
    db.commit()

    logger.info("Stream %s deleted by user %d (%d sightings unlinked)" % (
        stream_id, user.user_id, sighting_count))
    return {"deleted": True, "stream_id": stream_id, "sightings_unlinked": sighting_count}