"""
GET /api/crops/{person_folder}/{filename} — serve face crop images.
Verifies the person belongs to the user's scope.
"""
import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from api.deps import get_db, get_current_scope, Scope
from config import settings

router = APIRouter()


@router.get("/crops/{person_folder}/{filename}")
def get_crop(
    person_folder: str,
    filename: str,
    scope: Scope = Depends(get_current_scope),
    db=Depends(get_db),
):
    # Extract person_id from folder name (e.g. "person_5" → 5)
    try:
        person_id = int(person_folder.replace("person_", ""))
    except ValueError:
        raise HTTPException(404, "Invalid path")

    # Verify this person belongs to user's scope
    cur = db.cursor()
    shop_clause, shop_params = scope.sql_filter("shop_id")
    cur.execute(
        "SELECT id FROM persons WHERE id = %%s AND %s" % shop_clause,
        [person_id] + shop_params,
    )
    if not cur.fetchone():
        raise HTTPException(403, "Access denied")

    # Serve the file
    filepath = os.path.join(settings.crop_storage_dir, person_folder, filename)
    abs_path = os.path.abspath(filepath)
    abs_base = os.path.abspath(settings.crop_storage_dir)

    if not abs_path.startswith(abs_base):
        raise HTTPException(403, "Access denied")

    if not os.path.exists(abs_path):
        raise HTTPException(404, "Crop not found")

    return FileResponse(abs_path, media_type="image/jpeg")