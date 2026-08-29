"""
POST /api/identify — the core feature.

Owner uploads a photo - system finds the matching person - returns their sighting history.
"""
import io
import time
import logging
import numpy as np
import cv2
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from api.deps import get_detector, get_embedder, get_db
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/identify")
def identify(
    image: UploadFile = File(...),
    db=Depends(get_db),
    detector=Depends(get_detector),
    embedder=Depends(get_embedder),
):
    # ── Read image ──
    contents = image.file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(400, "Invalid image file")

    # ── Detect faces ──
    detections = detector.detect(frame, time.time())

    if len(detections) == 0:
        raise HTTPException(400, "No face detected in image")

    if len(detections) > 1:
        raise HTTPException(400, "Multiple faces detected, crop to one face")

    det = detections[0]

    # ── Crop and embed ──
    bbox = det.bbox.astype(int)
    h, w = frame.shape[:2]
    x1, y1 = max(0, bbox[0]), max(0, bbox[1])
    x2, y2 = min(w, bbox[2]), min(h, bbox[3])
    crop = frame[y1:y2, x1:x2]

    embedding = embedder.embed_single(crop, det.landmarks, det.bbox)

    # ── Search persons ──
    cur = db.cursor()

    cur.execute("SELECT id, centroid, label, first_seen, last_seen, sighting_count FROM persons")
    rows = cur.fetchall()

    if not rows:
        raise HTTPException(404, "No persons in database yet")

    best_id = None
    best_sim = -1
    best_row = None

    for row in rows:
        person_id = row[0]
        centroid_str = row[1]
        if isinstance(centroid_str, str):
            centroid = np.fromstring(centroid_str.strip("[]"), sep=",")
        else:
            centroid = np.array(centroid_str)

        sim = float(np.dot(centroid, embedding))
        if sim > best_sim:
            best_sim = sim
            best_id = person_id
            best_row = row

    if best_sim < settings.query_threshold:
        raise HTTPException(404, "No matching person found (best similarity: %.3f)" % best_sim)

    # ── Fetch sightings ──
    cur.execute(
        """
        SELECT id, camera_id, seen_at, quality_score, crop_path
        FROM sightings
        WHERE person_id = %s
        ORDER BY seen_at DESC
        """,
        (best_id,),
    )
    sighting_rows = cur.fetchall()

    sightings = []
    for s in sighting_rows:
        sighting = {
            "id": s[0],
            "camera_id": s[1],
            "seen_at": s[2].isoformat() if s[2] else None,
            "quality_score": s[3],
            "crop_url": "/api/crops/%s" % s[4].replace("\\", "/") if s[4] else None,
        }
        sightings.append(sighting)

    logger.info("Identified person %d (label=%s, similarity=%.3f)" % (best_id, best_row[2], best_sim))

    return {
        "person_id": best_id,
        "label": best_row[2],
        "similarity": round(best_sim, 4),
        "first_seen": best_row[3].isoformat() if best_row[3] else None,
        "last_seen": best_row[4].isoformat() if best_row[4] else None,
        "total_sightings": best_row[5],
        "sightings": sightings,
    }