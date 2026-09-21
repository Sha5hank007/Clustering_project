"""
POST /api/identify — upload suspect photo, find matching person within scope.
"""
import time
import logging
import numpy as np
import cv2
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from api.deps import get_db, get_detector, get_embedder, get_current_scope, Scope
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/identify")
def identify(
    image: UploadFile = File(...),
    job_id: str | None = Query(None),
    camera_id: str | None = Query(None),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
    detector=Depends(get_detector),
    embedder=Depends(get_embedder),
):
    # Read image
    contents = image.file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Invalid image file")

    # Detect
    detections = detector.detect(frame, time.time())
    if len(detections) == 0:
        raise HTTPException(400, "No face detected in image")
    if len(detections) > 1:
        raise HTTPException(400, "Multiple faces detected, crop to one face")

    det = detections[0]

    # Embed
    bbox = det.bbox.astype(int)
    h, w = frame.shape[:2]
    x1, y1 = max(0, bbox[0]), max(0, bbox[1])
    x2, y2 = min(w, bbox[2]), min(h, bbox[3])
    crop = frame[y1:y2, x1:x2]
    embedding = embedder.embed_single(crop, det.landmarks, det.bbox)

    # Search persons within scope
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("p.shop_id")

    cur.execute(
        "SELECT p.id, p.centroid, p.label, p.first_seen, p.last_seen, p.sighting_count FROM persons p WHERE %s" % shop_clause,
        shop_params,
    )
    rows = cur.fetchall()

    if not rows:
        raise HTTPException(404, "No persons in database for your scope")

    best_id = None
    best_sim = -1
    best_row = None

    for row in rows:
        centroid_str = row[1]
        if isinstance(centroid_str, str):
            centroid = np.fromstring(centroid_str.strip("[]"), sep=",")
        else:
            centroid = np.array(centroid_str)
        sim = float(np.dot(centroid, embedding))
        if sim > best_sim:
            best_sim = sim
            best_id = row[0]
            best_row = row

    if best_sim < settings.query_threshold:
        raise HTTPException(404, "No matching person found (best similarity: %.3f)" % best_sim)

    # Fetch sightings with optional filters
    sighting_clause, sighting_params = scope.sql_filter("s.shop_id")
    where_parts = ["s.person_id = %s", sighting_clause]
    params = [best_id] + sighting_params

    if job_id:
        where_parts.append("s.job_id = %s")
        params.append(job_id)
    if camera_id:
        where_parts.append("s.camera_id = %s")
        params.append(camera_id)

    where_sql = " AND ".join(where_parts)

    cur.execute(
        """
        SELECT s.id, s.camera_id, s.seen_at, s.quality_score, s.crop_path
        FROM sightings s WHERE %s ORDER BY s.seen_at DESC LIMIT 50
        """ % where_sql,
        params,
    )

    sightings = []
    for s in cur.fetchall():
        crop_url = None
        if s[4]:
            crop_url = "/api/crops/%s" % s[4].replace("\\", "/")
        sightings.append({
            "id": s[0], "camera_id": s[1],
            "seen_at": s[2].isoformat() if s[2] else None,
            "quality_score": s[3], "crop_url": crop_url,
        })

    logger.info("Identified person %d (similarity=%.3f)" % (best_id, best_sim))

    return {
        "person_id": best_id, "label": best_row[2],
        "similarity": round(best_sim, 4),
        "first_seen": best_row[3].isoformat() if best_row[3] else None,
        "last_seen": best_row[4].isoformat() if best_row[4] else None,
        "total_sightings": best_row[5],
        "sightings": sightings,
    }