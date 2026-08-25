"""Identity matching and sighting insertion for the ingestion pipeline."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Sequence

import numpy as np
from sqlalchemy import select

from config import settings
from db.models import Person, Sighting
from db.session import AsyncSessionLocal


async def _match_or_create_async(
    embedding: Sequence[float],
    seen_at: datetime | None = None,
) -> int:
    if seen_at is None:
        seen_at = datetime.now(timezone.utc)

    vector = _normalize(np.asarray(embedding, dtype=np.float32).reshape(-1))

    async with AsyncSessionLocal() as session:
        persons = (await session.execute(select(Person))).scalars().all()

        best_person: Person | None = None
        best_score = -1.0

        for person in persons:
            centroid = np.asarray(person.centroid, dtype=np.float32).reshape(-1)
            if centroid.size == 0:
                continue
            score = float(np.dot(vector, _normalize(centroid)))
            if score > best_score:
                best_score = score
                best_person = person

        if best_person is not None and best_score >= settings.match_threshold:
            old_count = float(best_person.embedding_count)
            old_centroid = np.asarray(best_person.centroid, dtype=np.float32).reshape(-1)
            combined = ((old_centroid * old_count) + vector) / (old_count + 1.0)
            best_person.centroid = list(_normalize(combined))
            best_person.embedding_count = int(old_count + 1)
            if seen_at < best_person.first_seen:
                best_person.first_seen = seen_at
            best_person.last_seen = max(best_person.last_seen, seen_at)
            await session.commit()
            return int(best_person.id)

        new_person = Person(
            centroid=list(vector),
            embedding_count=1,
            sighting_count=1,
            first_seen=seen_at,
            last_seen=seen_at,
            label=None,
            model_version="w600k_r50",
        )
        session.add(new_person)
        await session.flush()
        await session.commit()
        return int(new_person.id)


async def insert_sighting_async(
    person_id: int,
    camera_id: str,
    seen_at: datetime,
    embedding: Sequence[float] | None = None,
    quality_score: float | None = None,
    crop_path: str | None = None,
    bbox: list[float] | None = None,
) -> int:
    async with AsyncSessionLocal() as session:
        person = await session.get(Person, person_id)
        if person is None:
            raise ValueError(f"Person {person_id} does not exist")

        if seen_at < person.first_seen:
            person.first_seen = seen_at
        person.last_seen = max(person.last_seen, seen_at)
        person.sighting_count = (person.sighting_count or 0) + 1

        sighting = Sighting(
            person_id=person_id,
            camera_id=camera_id,
            seen_at=seen_at,
            quality_score=quality_score,
            embedding=list(np.asarray(embedding, dtype=np.float32).reshape(-1)) if embedding is not None else None,
            crop_path=crop_path,
            bbox=bbox,
        )
        session.add(sighting)
        await session.commit()
        await session.refresh(sighting)
        return int(sighting.id)


def match_or_create(embedding: Sequence[float], seen_at: datetime | None = None) -> int:
    return asyncio.run(_match_or_create_async(embedding, seen_at))


def insert_sighting(
    person_id: int,
    camera_id: str,
    seen_at: datetime,
    embedding: Sequence[float] | None = None,
    quality_score: float | None = None,
    crop_path: str | None = None,
    bbox: list[float] | None = None,
) -> int:
    return asyncio.run(
        insert_sighting_async(
            person_id=person_id,
            camera_id=camera_id,
            seen_at=seen_at,
            embedding=embedding,
            quality_score=quality_score,
            crop_path=crop_path,
            bbox=bbox,
        )
    )


def _normalize(vector: np.ndarray) -> np.ndarray:
    arr = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = np.linalg.norm(arr)
    if norm < 1e-12:
        return arr
    return arr / norm
