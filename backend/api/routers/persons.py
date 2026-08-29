"""
GET    /api/persons          — list all persons (paginated)
GET    /api/persons/{id}     — one person's full detail + sightings
PATCH  /api/persons/{id}/label — assign or remove a name
DELETE /api/persons/{id}     — remove person + all their data
"""
import os
import shutil
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from api.deps import get_db
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


class LabelUpdate(BaseModel):
    label: str | None = None


@router.get("/persons")
def list_persons(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
):
    cur = db.cursor()

    # Total count
    cur.execute("SELECT COUNT(*) FROM persons")
    total = cur.fetchone()[0]

    # Paginated list with latest crop
    offset = (page - 1) * limit
    cur.execute(
        """
        SELECT p.id, p.label, p.sighting_count, p.first_seen, p.last_seen,
               (SELECT s.crop_path FROM sightings s
                WHERE s.person_id = p.id AND s.crop_path IS NOT NULL
                ORDER BY s.seen_at DESC LIMIT 1) as latest_crop
        FROM persons p
        ORDER BY p.last_seen DESC
        LIMIT %s OFFSET %s
        """,
        (limit, offset),
    )

    persons = []
    for row in cur.fetchall():
        crop_url = None
        if row[5]:
            crop_url = "/api/crops/%s" % row[5].replace("\\", "/")

        persons.append({
            "id": row[0],
            "label": row[1],
            "sighting_count": row[2],
            "first_seen": row[3].isoformat() if row[3] else None,
            "last_seen": row[4].isoformat() if row[4] else None,
            "latest_crop_url": crop_url,
        })

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "persons": persons,
    }


@router.get("/persons/{person_id}")
def get_person(
    person_id: int,
    db=Depends(get_db),
):
    cur = db.cursor()

    cur.execute(
        """
        SELECT id, label, sighting_count, embedding_count,
               first_seen, last_seen
        FROM persons WHERE id = %s
        """,
        (person_id,),
    )
    row = cur.fetchone()

    if not row:
        raise HTTPException(404, "Person not found")

    # Fetch all sightings
    cur.execute(
        """
        SELECT id, camera_id, seen_at, quality_score, crop_path
        FROM sightings
        WHERE person_id = %s
        ORDER BY seen_at DESC
        """,
        (person_id,),
    )

    sightings = []
    for s in cur.fetchall():
        crop_url = None
        if s[4]:
            crop_url = "/api/crops/%s" % s[4].replace("\\", "/")

        sightings.append({
            "id": s[0],
            "camera_id": s[1],
            "seen_at": s[2].isoformat() if s[2] else None,
            "quality_score": s[3],
            "crop_url": crop_url,
        })

    return {
        "id": row[0],
        "label": row[1],
        "sighting_count": row[2],
        "embedding_count": row[3],
        "first_seen": row[4].isoformat() if row[4] else None,
        "last_seen": row[5].isoformat() if row[5] else None,
        "sightings": sightings,
    }


@router.patch("/persons/{person_id}/label")
def update_label(
    person_id: int,
    body: LabelUpdate,
    db=Depends(get_db),
):
    cur = db.cursor()

    cur.execute("SELECT id FROM persons WHERE id = %s", (person_id,))
    if not cur.fetchone():
        raise HTTPException(404, "Person not found")

    cur.execute(
        "UPDATE persons SET label = %s WHERE id = %s",
        (body.label, person_id),
    )
    db.commit()

    logger.info("Person %d label set to: %s" % (person_id, body.label))

    return {"id": person_id, "label": body.label}


@router.delete("/persons/{person_id}")
def delete_person(
    person_id: int,
    db=Depends(get_db),
):
    cur = db.cursor()

    cur.execute("SELECT id FROM persons WHERE id = %s", (person_id,))
    if not cur.fetchone():
        raise HTTPException(404, "Person not found")

    # Count sightings and crops before deleting
    cur.execute(
        "SELECT COUNT(*) FROM sightings WHERE person_id = %s",
        (person_id,),
    )
    sighting_count = cur.fetchone()[0]

    cur.execute(
        "SELECT COUNT(*) FROM sightings WHERE person_id = %s AND crop_path IS NOT NULL",
        (person_id,),
    )
    crop_count = cur.fetchone()[0]

    # Delete from DB (cascade deletes sightings)
    cur.execute("DELETE FROM persons WHERE id = %s", (person_id,))
    db.commit()

    # Delete crop folder from disk
    crop_dir = os.path.join(settings.crop_storage_dir, "person_%d" % person_id)
    if os.path.exists(crop_dir):
        shutil.rmtree(crop_dir)

    logger.info("Deleted person %d (%d sightings, %d crops)" % (person_id, sighting_count, crop_count))

    return {
        "deleted": True,
        "sightings_removed": sighting_count,
        "crops_removed": crop_count,
    }