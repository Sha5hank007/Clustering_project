"""Router for managing persons and viewing sighting histories."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.deps import get_db
from db.models import Person, Sighting
from config import settings

router = APIRouter(prefix="/persons", tags=["Persons"])


class PersonLabelUpdate(BaseModel):
    label: Optional[str] = None


class SightingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    camera_id: str
    seen_at: datetime
    quality_score: Optional[float] = None
    crop_url: Optional[str] = None
    bbox: Optional[list] = None


class PersonSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    label: Optional[str] = None
    sighting_count: int
    first_seen: datetime
    last_seen: datetime
    thumbnail_url: Optional[str] = None


class PersonDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    label: Optional[str] = None
    embedding_count: int
    sighting_count: int
    first_seen: datetime
    last_seen: datetime
    model_version: str
    sightings: List[SightingOut] = []


def _format_crop_url(crop_path: Optional[str]) -> Optional[str]:
    if not crop_path:
        return None
    # Normalize separators
    normalized = crop_path.replace("\\", "/")
    # Remove leading ./ or data/crops/ if present
    if normalized.startswith("data/crops/"):
        normalized = normalized[len("data/crops/"):]
    elif normalized.startswith("./data/crops/"):
        normalized = normalized[len("./data/crops/"):]
    return f"/api/crops/{normalized}"


@router.get("", response_model=List[PersonSummary], summary="List all known persons")
async def list_persons(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None, description="Search by label"),
    labeled_only: bool = Query(False, description="Filter only persons with labels"),
    db: AsyncSession = Depends(get_db),
):
    """List known persons with pagination, label search, and thumbnail crops."""
    query = select(Person).order_by(desc(Person.last_seen))

    if search:
        query = query.where(Person.label.ilike(f"%{search.strip()}%"))
    if labeled_only:
        query = query.where(Person.label.isnot(None), Person.label != "")

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    persons = result.scalars().all()

    summaries = []
    for p in persons:
        # Fetch the most recent crop for this person
        crop_query = (
            select(Sighting.crop_path)
            .where(Sighting.person_id == p.id, Sighting.crop_path.isnot(None))
            .order_by(desc(Sighting.seen_at))
            .limit(1)
        )
        crop_res = await db.execute(crop_query)
        crop_path = crop_res.scalar_one_or_none()

        summaries.append(
            PersonSummary(
                id=p.id,
                label=p.label,
                sighting_count=p.sighting_count or 1,
                first_seen=p.first_seen,
                last_seen=p.last_seen,
                thumbnail_url=_format_crop_url(crop_path),
            )
        )

    return summaries


@router.get("/{person_id}", response_model=PersonDetail, summary="Get person details and sighting history")
async def get_person(
    person_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Retrieve full details of a person including all sighting history."""
    query = (
        select(Person)
        .options(selectinload(Person.sightings))
        .where(Person.id == person_id)
    )
    result = await db.execute(query)
    person = result.scalar_one_or_none()

    if not person:
        raise HTTPException(status_code=404, detail=f"Person with ID {person_id} not found.")

    sorted_sightings = sorted(person.sightings, key=lambda s: s.seen_at, reverse=True)
    sightings_out = [
        SightingOut(
            id=s.id,
            camera_id=s.camera_id,
            seen_at=s.seen_at,
            quality_score=s.quality_score,
            crop_url=_format_crop_url(s.crop_path),
            bbox=s.bbox,
        )
        for s in sorted_sightings
    ]

    return PersonDetail(
        id=person.id,
        label=person.label,
        embedding_count=person.embedding_count or 1,
        sighting_count=person.sighting_count or len(sorted_sightings),
        first_seen=person.first_seen,
        last_seen=person.last_seen,
        model_version=person.model_version or "w600k_r50",
        sightings=sightings_out,
    )


@router.patch("/{person_id}/label", response_model=PersonSummary, summary="Update person label")
async def update_person_label(
    person_id: int,
    payload: PersonLabelUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Set or update the name/label for a known person."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail=f"Person with ID {person_id} not found.")

    person.label = payload.label.strip() if payload.label else None
    await db.commit()
    await db.refresh(person)

    crop_query = (
        select(Sighting.crop_path)
        .where(Sighting.person_id == person.id, Sighting.crop_path.isnot(None))
        .order_by(desc(Sighting.seen_at))
        .limit(1)
    )
    crop_res = await db.execute(crop_query)
    crop_path = crop_res.scalar_one_or_none()

    return PersonSummary(
        id=person.id,
        label=person.label,
        sighting_count=person.sighting_count or 1,
        first_seen=person.first_seen,
        last_seen=person.last_seen,
        thumbnail_url=_format_crop_url(crop_path),
    )


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a person")
async def delete_person(
    person_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a person and all their sightings from the database."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail=f"Person with ID {person_id} not found.")

    await db.delete(person)
    await db.commit()
    return None
