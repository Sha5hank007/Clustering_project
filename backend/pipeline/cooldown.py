"""Cooldown logic for duplicate sightings on the same camera."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, select

from config import settings
from db.async_runner import run_async
from db.models import Person, Sighting
from db.session import AsyncSessionLocal


async def _should_insert_sighting_async(
    person_id: int,
    camera_id: str,
    seen_at: datetime | None = None,
) -> bool:
    if seen_at is None:
        seen_at = datetime.now(timezone.utc)

    cutoff = seen_at - timedelta(hours=settings.cooldown_hours)

    async with AsyncSessionLocal() as session:
        recent = await session.execute(
           select(Sighting)
           .where(
               and_(
                   Sighting.person_id == person_id,
                   Sighting.camera_id == camera_id,
                   Sighting.seen_at >= cutoff,
               )
           )
           .order_by(Sighting.seen_at.desc())
           .limit(1)
        )
        latest = recent.scalar_one_or_none()

        if latest is None:
           return True

        person = await session.get(Person, person_id)
        if person is not None:
           person.last_seen = max(person.last_seen, seen_at)
           person.sighting_count = (person.sighting_count or 0) + 1
        await session.commit()
        return False


def should_insert_sighting(
    person_id: int,
    camera_id: str,
    seen_at: datetime | None = None,
) -> bool:
    return run_async(_should_insert_sighting_async(person_id, camera_id, seen_at))
