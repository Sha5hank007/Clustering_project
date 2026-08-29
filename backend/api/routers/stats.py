"""
GET /api/stats — dashboard numbers.
"""
import os
from fastapi import APIRouter, Depends
from api.deps import get_db
from config import settings

router = APIRouter()


@router.get("/stats")
def get_stats(db=Depends(get_db)):
    cur = db.cursor()

    cur.execute("SELECT COUNT(*) FROM persons")
    total_persons = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM sightings")
    total_sightings = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM sightings WHERE crop_path IS NOT NULL")
    total_crops_db = cur.fetchone()[0]

    cur.execute("SELECT MIN(first_seen), MAX(last_seen) FROM persons")
    time_row = cur.fetchone()
    first_sighting = time_row[0].isoformat() if time_row[0] else None
    last_sighting = time_row[1].isoformat() if time_row[1] else None

    cur.execute("SELECT DISTINCT camera_id FROM sightings ORDER BY camera_id")
    cameras = [row[0] for row in cur.fetchall()]

    # Count actual files on disk and total size
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
    }