"""Retention policy for saved face crops."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

import cv2
import numpy as np
from sqlalchemy import select

from config import settings
from db.models import Sighting
from db.session import AsyncSessionLocal


async def _save_best_crop_async(
    person_id: int,
    crop: np.ndarray,
    seen_at: datetime,
    quality_score: float,
) -> str | None:
    if crop is None or crop.size == 0:
        return None

    os.makedirs(settings.crop_storage_dir, exist_ok=True)
    bucket_start = _bucket_start(seen_at)
    bucket_label = datetime.fromtimestamp(bucket_start, tz=timezone.utc).strftime("%Y%m%d")
    bucket_dir = os.path.join(settings.crop_storage_dir, str(person_id), bucket_label)
    os.makedirs(bucket_dir, exist_ok=True)

    file_name = f"{int(seen_at.timestamp() * 1000)}_{int(quality_score * 1000)}.jpg"
    path = os.path.join(bucket_dir, file_name)

    ok = cv2.imwrite(path, crop)
    if not ok:
        return None

    async with AsyncSessionLocal() as session:
        existing = await session.execute(
            select(Sighting)
            .where(
                Sighting.person_id == person_id,
                Sighting.crop_path.is_not(None),
                Sighting.seen_at >= datetime.fromtimestamp(bucket_start, tz=timezone.utc),
                Sighting.seen_at < datetime.fromtimestamp(bucket_start + settings.retention_window_days * 86400, tz=timezone.utc),
            )
            .order_by(Sighting.quality_score.desc().nullslast(), Sighting.seen_at.desc())
            .limit(1)
        )
        best = existing.scalar_one_or_none()

        if best is not None and best.quality_score is not None and quality_score <= best.quality_score:
            return best.crop_path

        if best is not None:
            best.crop_path = path
            best.quality_score = max(best.quality_score or 0.0, quality_score)
            if best.seen_at < seen_at:
                best.seen_at = seen_at
        await session.commit()

    return path


def save_best_crop(
    person_id: int,
    crop: np.ndarray,
    seen_at: datetime,
    quality_score: float,
) -> str | None:
    return asyncio.run(_save_best_crop_async(person_id, crop, seen_at, quality_score))


def _bucket_start(seen_at: datetime) -> int:
    seconds = int(seen_at.timestamp())
    bucket_seconds = settings.retention_window_days * 86400
    return (seconds // bucket_seconds) * bucket_seconds
