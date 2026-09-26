"""
GET /api/stats — dashboard numbers, scoped to user's shop or tenant.
"""
import os
from fastapi import APIRouter, Depends
from api.deps import get_db, get_current_scope, Scope
from config import settings

router = APIRouter()


@router.get("/stats")
def get_stats(
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute("SELECT COUNT(*) FROM persons WHERE %s" % shop_clause, shop_params)
    total_persons = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM sightings WHERE %s" % shop_clause, shop_params)
    total_sightings = cur.fetchone()[0]

    cur.execute(
        "SELECT COUNT(*) FROM sightings WHERE crop_path IS NOT NULL AND %s" % shop_clause,
        shop_params,
    )
    total_crops_db = cur.fetchone()[0]

    cur.execute(
        "SELECT MIN(first_seen), MAX(last_seen) FROM persons WHERE %s" % shop_clause,
        shop_params,
    )
    time_row = cur.fetchone()
    first_sighting = time_row[0].isoformat() if time_row[0] else None
    last_sighting = time_row[1].isoformat() if time_row[1] else None

    cur.execute(
        "SELECT DISTINCT camera_id FROM sightings WHERE %s ORDER BY camera_id" % shop_clause,
        shop_params,
    )
    cameras = [row[0] for row in cur.fetchall()]

    # Active streams count
    stream_clause, stream_params = scope.sql_filter("shop_id")
    cur.execute(
        "SELECT COUNT(*) FROM live_streams WHERE status = 'running' AND %s" % stream_clause,
        stream_params,
    )
    active_streams = cur.fetchone()[0]

    # Pending jobs count
    job_clause, job_params = scope.sql_filter("shop_id")
    cur.execute(
        "SELECT COUNT(*) FROM ingest_jobs WHERE status IN ('queued', 'processing') AND %s" % job_clause,
        job_params,
    )
    pending_jobs = cur.fetchone()[0]

    # Disk usage
    total_files = 0
    total_bytes = 0
    crop_dir = settings.crop_storage_dir
    if os.path.exists(crop_dir):
        for root, dirs, files in os.walk(crop_dir):
            for f in files:
                if f.endswith((".jpg", ".jpeg", ".png")):
                    total_files += 1
                    total_bytes += os.path.getsize(os.path.join(root, f))

    return {
        "total_persons": total_persons,
        "total_sightings": total_sightings,
        "total_crops_on_disk": total_files,
        "storage_used_mb": round(total_bytes / (1024 * 1024), 2),
        "first_sighting": first_sighting,
        "last_sighting": last_sighting,
        "cameras": cameras,
        "active_streams": active_streams,
        "pending_jobs": pending_jobs,
    }