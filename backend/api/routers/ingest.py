"""
POST /api/ingest              — upload video (admin picks shop, guard/manager auto-scoped)
GET  /api/ingest/status/{id}  — check job progress
GET  /api/ingest/jobs         — list jobs
"""
import os
import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Query
from api.deps import get_db, get_current_user, get_current_scope, CurrentUser, Scope
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_shop_id(user: CurrentUser, shop_id: int | None, db) -> int:
    """Admin must provide shop_id. Guard/manager uses their own."""
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


@router.post("/ingest")
def upload_video(
    video: UploadFile = File(...),
    camera_id: str = Form(...),
    recorded_at: str = Form(...),
    shop_id: int | None = Form(None),
    user: CurrentUser = Depends(get_current_user),
    db=Depends(get_db),
):
    effective_shop_id = _resolve_shop_id(user, shop_id, db)

    try:
        rec_dt = datetime.fromisoformat(recorded_at)
        if rec_dt.tzinfo is None:
            rec_dt = rec_dt.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "Invalid recorded_at format. Use ISO: 2026-08-26T14:00:00")

    job_id = uuid.uuid4().hex[:12]
    os.makedirs(settings.ingest_dir, exist_ok=True)

    ext = os.path.splitext(video.filename)[1] or ".mp4"
    video_path = os.path.join(settings.ingest_dir, "%s%s" % (job_id, ext))

    with open(video_path, "wb") as f:
        while True:
            chunk = video.file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    file_size_mb = os.path.getsize(video_path) / (1024 * 1024)

    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO ingest_jobs (id, shop_id, uploaded_by, original_name, video_path,
                                 camera_id, recorded_at, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'queued')
        """,
        (job_id, effective_shop_id, user.user_id, video.filename, video_path, camera_id, rec_dt),
    )
    db.commit()

    logger.info("Video uploaded: job=%s shop=%d user=%d" % (job_id, effective_shop_id, user.user_id))

    return {
        "job_id": job_id, "status": "queued",
        "original_name": video.filename, "camera_id": camera_id,
        "shop_id": effective_shop_id, "file_size_mb": round(file_size_mb, 2),
    }


@router.get("/ingest/status/{job_id}")
def get_job_status(
    job_id: str,
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    clause, params = scope.sql_filter("j.shop_id")
    cur = db.cursor()
    cur.execute(
        """
        SELECT j.id, j.original_name, j.camera_id, j.recorded_at, j.fps,
               j.total_frames, j.processed_frame, j.status, j.error,
               j.persons_found, j.sightings_added, j.created_at, j.shop_id
        FROM ingest_jobs j
        WHERE j.id = %%s AND %s
        """ % clause,
        [job_id] + params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Job not found")

    progress = 0.0
    if row[5] and row[5] > 0:
        progress = round((row[6] or 0) / row[5] * 100, 1)

    return {
        "job_id": row[0], "original_name": row[1], "camera_id": row[2],
        "recorded_at": row[3].isoformat() if row[3] else None,
        "fps": row[4], "total_frames": row[5], "processed_frame": row[6],
        "progress_percent": progress, "status": row[7], "error": row[8],
        "persons_found": row[9], "sightings_added": row[10],
        "created_at": row[11].isoformat() if row[11] else None,
        "shop_id": row[12],
    }


@router.get("/ingest/jobs")
def list_jobs(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    clause, params = scope.sql_filter("j.shop_id")
    cur = db.cursor()
    cur.execute("SELECT COUNT(*) FROM ingest_jobs j WHERE %s" % clause, params)
    total = cur.fetchone()[0]
    offset = (page - 1) * limit
    cur.execute(
        """
        SELECT j.id, j.original_name, j.camera_id, j.recorded_at,
               j.total_frames, j.processed_frame, j.status,
               j.persons_found, j.sightings_added, j.created_at, j.shop_id
        FROM ingest_jobs j
        WHERE %s
        ORDER BY j.created_at DESC
        LIMIT %%s OFFSET %%s
        """ % clause,
        params + [limit, offset],
    )

    jobs = []
    for row in cur.fetchall():
        progress = 0.0
        if row[4] and row[4] > 0:
            progress = round((row[5] or 0) / row[4] * 100, 1)
        jobs.append({
            "job_id": row[0], "original_name": row[1], "camera_id": row[2],
            "recorded_at": row[3].isoformat() if row[3] else None,
            "progress_percent": progress, "status": row[6],
            "persons_found": row[7], "sightings_added": row[8],
            "created_at": row[9].isoformat() if row[9] else None,
            "shop_id": row[10],
        })
    total_pages = (total + limit - 1) // limit if total > 0 else 0
    return {
        "jobs": jobs, "total": total, "page": page,
        "limit": limit, "total_pages": total_pages,
    }