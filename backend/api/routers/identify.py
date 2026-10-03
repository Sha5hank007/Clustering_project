"""Router for suspect photo identification and forensic match queries."""

from __future__ import annotations

import time
from datetime import datetime
from typing import List, Optional
import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.deps import get_db, get_detector, get_embedder
from config import settings
from db.models import Person, Sighting
from pipeline.detector import Detector
from pipeline.embedder import FaceEmbedder, _normalize

router = APIRouter(prefix="/identify", tags=["Identification"])


class SightingMatch(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    seen_at: datetime
    camera_id: str
    quality_score: Optional[float] = None
    crop_url: Optional[str] = None
    bbox: Optional[list] = None


class IdentificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    matched: bool = True
    person_id: int
    label: str
    similarity: float
    first_seen: datetime
    last_seen: datetime
    total_sightings: int
    sightings: List[SightingMatch] = []


def _format_crop_url(crop_path: Optional[str]) -> Optional[str]:
    if not crop_path:
        return None
    normalized = crop_path.replace("\\", "/")
    if normalized.startswith("data/crops/"):
        normalized = normalized[len("data/crops/"):]
    elif normalized.startswith("./data/crops/"):
        normalized = normalized[len("./data/crops/"):]
    return f"/api/crops/{normalized}"


@router.post(
    "",
    response_model=IdentificationResponse,
    summary="Identify a person from an uploaded photo",
)
async def identify_person(
    image: UploadFile = File(..., description="Suspect image file"),
    db: AsyncSession = Depends(get_db),
    detector: Detector = Depends(get_detector),
    embedder: FaceEmbedder = Depends(get_embedder),
):
    """
    Forensic match query:
    1. Decode uploaded image
    2. Detect face and keypoints using SCRFD
    3. Align & compute 512-d ArcFace embedding
    4. Compute cosine similarity against all known person centroids
    5. Return matched person history if similarity >= query_threshold
    """
    # 1. Read & decode image
    contents = await image.read()
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty image file provided.",
        )

    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None or frame.size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image format. Could not decode image.",
        )

    # 2. Detect face
    detections = detector.detect(frame, timestamp=time.time())
    if not detections:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No face detected in the uploaded image. Ensure good lighting and a clear front-facing angle.",
        )

    # Pick the detection with the highest confidence score
    best_det = max(detections, key=lambda d: d.score)

    # Extract crop
    x1, y1, x2, y2 = [int(v) for v in best_det.bbox]
    h, w = frame.shape[:2]
    # Add a slight margin (20%) for alignment
    margin_x = int((x2 - x1) * 0.2)
    margin_y = int((y2 - y1) * 0.2)
    cx1 = max(0, x1 - margin_x)
    cy1 = max(0, y1 - margin_y)
    cx2 = min(w, x2 + margin_x)
    cy2 = min(h, y2 + margin_y)

    crop = frame[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        crop = frame

    crop_bbox = np.array([cx1, cy1, cx2, cy2], dtype=np.float32)

    # 3. Embed face
    query_embedding = embedder.embed_face(crop, crop_bbox, best_det.landmarks)
    query_vector = _normalize(query_embedding)

    # 4. Search DB persons
    persons_query = select(Person).options(selectinload(Person.sightings))
    result = await db.execute(persons_query)
    persons = result.scalars().all()

    if not persons:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No persons found in the database yet. Process camera footage or ingest video first.",
        )

    best_match_person: Optional[Person] = None
    best_score = -1.0

    for person in persons:
        centroid = np.asarray(person.centroid, dtype=np.float32).reshape(-1)
        if centroid.size == 0:
            continue
        score = float(np.dot(query_vector, _normalize(centroid)))
        if score > best_score:
            best_score = score
            best_match_person = person

    # 5. Check threshold
    if best_match_person is None or best_score < settings.query_threshold:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No matching person found (Highest similarity was {max(0.0, best_score):.1%}, threshold is {settings.query_threshold:.1%}).",
        )

    sorted_sightings = sorted(
        best_match_person.sightings, key=lambda s: s.seen_at, reverse=True
    )

    sightings_matches = [
        SightingMatch(
            id=s.id,
            seen_at=s.seen_at,
            camera_id=s.camera_id,
            quality_score=s.quality_score,
            crop_url=_format_crop_url(s.crop_path),
            bbox=s.bbox,
        )
        for s in sorted_sightings
    ]

    label_text = (
        best_match_person.label
        if best_match_person.label
        else f"Person #{best_match_person.id}"
    )

    return IdentificationResponse(
        matched=True,
        person_id=best_match_person.id,
        label=label_text,
        similarity=float(best_score),
        first_seen=best_match_person.first_seen,
        last_seen=best_match_person.last_seen,
        total_sightings=best_match_person.sighting_count or len(sorted_sightings),
        sightings=sightings_matches,
    )
