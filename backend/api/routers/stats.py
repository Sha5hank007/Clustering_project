"""Router for dashboard overview metrics and system statistics."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from db.models import Person, Sighting
from config import settings

router = APIRouter(prefix="/stats", tags=["Stats"])


class RecentSightingItem(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    person_id: int
    person_label: Optional[str] = None
    camera_id: str
    seen_at: datetime
    crop_url: Optional[str] = None


class SystemStatsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    total_persons: int
    total_sightings: int
    labeled_persons: int
    sightings_last_24h: int
    cameras_count: int
    camera_breakdown: Dict[str, int]
    recent_sightings: List[RecentSightingItem]
    model_detector: str
    model_recognizer: str
    match_threshold: float
    query_threshold: float


def _format_crop_url(crop_path: Optional[str]) -> Optional[str]:
    if not crop_path:
        return None
    normalized = crop_path.replace("\\", "/")
    if normalized.startswith("data/crops/"):
        normalized = normalized[len("data/crops/"):]
    elif normalized.startswith("./data/crops/"):
        normalized = normalized[len("./data/crops/"):]
    return f"/api/crops/{normalized}"


@router.get("", response_model=SystemStatsResponse, summary="Get system statistics and metrics")
async def get_system_stats(
    db: AsyncSession = Depends(get_db),
):
    """Return key metrics: person count, sighting count, 24h activity, camera breakdown, and recent events."""
    # 1. Total persons
    p_count_res = await db.execute(select(func.count(Person.id)))
    total_persons = p_count_res.scalar_one() or 0

    # 2. Total sightings
    s_count_res = await db.execute(select(func.count(Sighting.id)))
    total_sightings = s_count_res.scalar_one() or 0

    # 3. Labeled persons
    labeled_res = await db.execute(
        select(func.count(Person.id)).where(Person.label.isnot(None), Person.label != "")
    )
    labeled_persons = labeled_res.scalar_one() or 0

    # 4. Sightings last 24 hours
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    s_24h_res = await db.execute(
        select(func.count(Sighting.id)).where(Sighting.seen_at >= since_24h)
    )
    sightings_last_24h = s_24h_res.scalar_one() or 0

    # 5. Camera breakdown
    camera_group_res = await db.execute(
        select(Sighting.camera_id, func.count(Sighting.id)).group_by(Sighting.camera_id)
    )
    camera_breakdown = {cam: count for cam, count in camera_group_res.all()}

    # 6. Recent sightings (last 6)
    recent_query = (
        select(Sighting, Person.label)
        .join(Person, Sighting.person_id == Person.id)
        .order_by(desc(Sighting.seen_at))
        .limit(6)
    )
    recent_res = await db.execute(recent_query)
    recent_items = []
    for sighting, label in recent_res.all():
        recent_items.append(
            RecentSightingItem(
                id=sighting.id,
                person_id=sighting.person_id,
                person_label=label or f"Person #{sighting.person_id}",
                camera_id=sighting.camera_id,
                seen_at=sighting.seen_at,
                crop_url=_format_crop_url(sighting.crop_path),
            )
        )

    return SystemStatsResponse(
        total_persons=total_persons,
        total_sightings=total_sightings,
        labeled_persons=labeled_persons,
        sightings_last_24h=sightings_last_24h,
        cameras_count=len(camera_breakdown),
        camera_breakdown=camera_breakdown,
        recent_sightings=recent_items,
        model_detector=settings.detector_model,
        model_recognizer=settings.recognizer_model,
        match_threshold=settings.match_threshold,
        query_threshold=settings.query_threshold,
    )
