"""
GET /api/crops/{path} — serve stored face crop images from disk.

crop_path in the database looks like: ../data/crops/person_1/2026-08-26_173000.jpg
This endpoint serves those files.
"""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from config import settings

router = APIRouter()


@router.get("/crops/{person_folder}/{filename}")
def get_crop(person_folder: str, filename: str):
    filepath = os.path.join(settings.crop_storage_dir, person_folder, filename)

    # Resolve to absolute path and check it's within crop_storage_dir
    # Prevents directory traversal attacks (../../etc/passwd)
    abs_path = os.path.abspath(filepath)
    abs_base = os.path.abspath(settings.crop_storage_dir)

    if not abs_path.startswith(abs_base):
        raise HTTPException(403, "Access denied")

    if not os.path.exists(abs_path):
        raise HTTPException(404, "Crop not found")

    return FileResponse(abs_path, media_type="image/jpeg")