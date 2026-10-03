"""Router for serving stored face crop images."""

from __future__ import annotations

import os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from config import settings

router = APIRouter(prefix="/crops", tags=["Crops"])


@router.get("/{crop_path:path}", summary="Serve a stored face crop image")
async def get_crop(crop_path: str):
    """
    Serve a face crop image from the crops storage directory.
    Validates against path traversal.
    """
    base_dir = Path(settings.crop_storage_dir).resolve()
    target_path = (base_dir / crop_path).resolve()

    # Prevent path traversal outside crop_storage_dir
    try:
        target_path.relative_to(base_dir)
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Invalid crop path.")

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="Crop image not found.")

    return FileResponse(path=str(target_path), media_type="image/jpeg")
