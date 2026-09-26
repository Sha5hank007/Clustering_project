"""
GET    /api/persons              — list persons (paginated, filterable by job_id)
GET    /api/persons/{id}         — person detail + paginated sightings
PATCH  /api/persons/{id}/label   — assign name (manager/admin only)
DELETE /api/persons/{id}         — remove person (manager/admin only)
"""
import os
import shutil
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from api.deps import get_db, get_current_scope, require_role, Scope, CurrentUser
from api.routers.crops import crop_path_to_url
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


class LabelUpdate(BaseModel):
    label: str | None = None


@router.get("/persons")
def list_persons(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    job_id: str | None = Query(None),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("p.shop_id")

    if job_id:
        # Persons found in a specific video
        count_sql = """
            SELECT COUNT(DISTINCT p.id) FROM persons p
            JOIN sightings s ON s.person_id = p.id
            WHERE s.job_id = %%s AND %s
        """ % shop_clause
        cur.execute(count_sql, [job_id] + shop_params)
        total = cur.fetchone()[0]

        offset = (page - 1) * limit
        data_sql = """
            SELECT DISTINCT p.id, p.label, p.sighting_count, p.first_seen, p.last_seen,
                   (SELECT s2.crop_path FROM sightings s2
                    WHERE s2.person_id = p.id AND s2.crop_path IS NOT NULL
                    ORDER BY s2.seen_at DESC LIMIT 1) as latest_crop
            FROM persons p
            JOIN sightings s ON s.person_id = p.id
            WHERE s.job_id = %%s AND %s
            ORDER BY p.last_seen DESC
            LIMIT %%s OFFSET %%s
        """ % shop_clause
        cur.execute(data_sql, [job_id] + shop_params + [limit, offset])
    else:
        # All persons
        count_sql = "SELECT COUNT(*) FROM persons p WHERE %s" % shop_clause
        cur.execute(count_sql, shop_params)
        total = cur.fetchone()[0]

        offset = (page - 1) * limit
        data_sql = """
            SELECT p.id, p.label, p.sighting_count, p.first_seen, p.last_seen,
                   (SELECT s.crop_path FROM sightings s
                    WHERE s.person_id = p.id AND s.crop_path IS NOT NULL
                    ORDER BY s.seen_at DESC LIMIT 1) as latest_crop
            FROM persons p
            WHERE %s
            ORDER BY p.last_seen DESC
            LIMIT %%s OFFSET %%s
        """ % shop_clause
        cur.execute(data_sql, shop_params + [limit, offset])

    persons = []
    for row in cur.fetchall():
        crop_url = None
        if row[5]:
            crop_url = crop_path_to_url(row[5])
        persons.append({
            "id": row[0], "label": row[1], "sighting_count": row[2],
            "first_seen": row[3].isoformat() if row[3] else None,
            "last_seen": row[4].isoformat() if row[4] else None,
            "latest_crop_url": crop_url,
        })

    total_pages = (total + limit - 1) // limit if total > 0 else 0

    return {
        "total": total, "page": page, "limit": limit,
        "total_pages": total_pages, "persons": persons,
    }


@router.get("/persons/{person_id}")
def get_person(
    person_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    job_id: str | None = Query(None),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("p.shop_id")

    cur.execute(
        """
        SELECT p.id, p.label, p.sighting_count, p.embedding_count,
               p.first_seen, p.last_seen
        FROM persons p
        WHERE p.id = %%s AND %s
        """ % shop_clause,
        [person_id] + shop_params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Person not found")

    # Paginated sightings
    sighting_clause, sighting_params = scope.sql_filter("s.shop_id")

    if job_id:
        sighting_where = "s.person_id = %%s AND s.job_id = %%s AND %s" % sighting_clause
        count_params = [person_id, job_id] + sighting_params
    else:
        sighting_where = "s.person_id = %%s AND %s" % sighting_clause
        count_params = [person_id] + sighting_params

    cur.execute(
        "SELECT COUNT(*) FROM sightings s WHERE %s" % sighting_where,
        count_params,
    )
    total_sightings = cur.fetchone()[0]

    offset = (page - 1) * limit
    cur.execute(
        """
        SELECT s.id, s.camera_id, s.seen_at, s.quality_score, s.crop_path
        FROM sightings s
        WHERE %s
        ORDER BY s.seen_at DESC
        LIMIT %%s OFFSET %%s
        """ % sighting_where,
        count_params + [limit, offset],
    )

    sightings = []
    for s in cur.fetchall():
        crop_url = None
        if s[4]:
            crop_url = crop_path_to_url(s[4])
        sightings.append({
            "id": s[0], "camera_id": s[1],
            "seen_at": s[2].isoformat() if s[2] else None,
            "quality_score": s[3], "crop_url": crop_url,
        })

    total_pages = (total_sightings + limit - 1) // limit if total_sightings > 0 else 0

    return {
        "id": row[0], "label": row[1], "sighting_count": row[2],
        "embedding_count": row[3],
        "first_seen": row[4].isoformat() if row[4] else None,
        "last_seen": row[5].isoformat() if row[5] else None,
        "sightings_total": total_sightings, "sightings_page": page,
        "sightings_total_pages": total_pages,
        "sightings": sightings,
    }


@router.patch("/persons/{person_id}/label")
def update_label(
    person_id: int,
    body: LabelUpdate,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute(
        "SELECT id FROM persons WHERE id = %%s AND %s" % shop_clause,
        [person_id] + shop_params,
    )
    if not cur.fetchone():
        raise HTTPException(404, "Person not found")

    cur.execute("UPDATE persons SET label = %s WHERE id = %s", (body.label, person_id))
    db.commit()

    logger.info("Person %d label set to: %s (by user %d)" % (person_id, body.label, user.user_id))
    return {"id": person_id, "label": body.label}


@router.delete("/persons/{person_id}")
def delete_person(
    person_id: int,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")

    cur.execute(
        "SELECT id FROM persons WHERE id = %%s AND %s" % shop_clause,
        [person_id] + shop_params,
    )
    if not cur.fetchone():
        raise HTTPException(404, "Person not found")

    cur.execute("SELECT COUNT(*) FROM sightings WHERE person_id = %s", (person_id,))
    sighting_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM sightings WHERE person_id = %s AND crop_path IS NOT NULL", (person_id,))
    crop_count = cur.fetchone()[0]

    cur.execute("DELETE FROM persons WHERE id = %s", (person_id,))
    db.commit()

    crop_dir = os.path.join(settings.crop_storage_dir, "person_%d" % person_id)
    if os.path.exists(crop_dir):
        shutil.rmtree(crop_dir)

    logger.info("Deleted person %d (by user %d)" % (person_id, user.user_id))
    return {"deleted": True, "sightings_removed": sighting_count, "crops_removed": crop_count}