"""Router for uploading video files for automated processing and tracking ingest jobs."""

from __future__ import annotations

import os
import uuid
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from config import settings

router = APIRouter(prefix="/ingest", tags=["Ingestion"])

# In-memory registry for ingest jobs
_INGEST_JOBS: Dict[str, dict] = {}


class IngestJobResponse(BaseModel):
    job_id: str
    filename: str
    camera_id: str
    status: str
    progress: float
    created_at: datetime
    completed_at: Optional[datetime] = None
    frames_processed: int = 0
    faces_detected: int = 0
    sightings_added: int = 0
    error: Optional[str] = None


@router.post("", response_model=IngestJobResponse, summary="Upload video for background ingestion")
async def upload_video(
    video: UploadFile = File(..., description="Video file (.mp4, .avi, .mkv, .mov)"),
    camera_id: str = Form("default_cam"),
    recorded_at: Optional[str] = Form(None),
):
    """
    Accepts video upload, saves it to data/ingest/, and registers an ingest job.
    """
    if not video.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No video file provided."
        )

    # Validate file extension
    ext = Path(video.filename).suffix.lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported video format: '{ext}'. Allowed: .mp4, .avi, .mov, .mkv, .webm",
        )

    # Ensure ingest directory exists
    ingest_dir = Path("./data/ingest").resolve()
    ingest_dir.mkdir(parents=True, exist_ok=True)

    job_id = str(uuid.uuid4())[:8]
    safe_name = f"{job_id}_{video.filename}"
    file_path = ingest_dir / safe_name

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(video.file, buffer)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save video: {str(exc)}",
        )

    job_record = {
        "job_id": job_id,
        "filename": video.filename,
        "saved_path": str(file_path),
        "camera_id": camera_id,
        "status": "queued",
        "progress": 0.0,
        "created_at": datetime.now(timezone.utc),
        "completed_at": None,
        "frames_processed": 0,
        "faces_detected": 0,
        "sightings_added": 0,
        "error": None,
    }
    _INGEST_JOBS[job_id] = job_record

    return IngestJobResponse(**job_record)


@router.get("/jobs", response_model=List[IngestJobResponse], summary="List all video ingest jobs")
async def list_jobs():
    """List all registered video ingestion jobs."""
    jobs = list(_INGEST_JOBS.values())
    jobs.sort(key=lambda j: j["created_at"], reverse=True)
    return [IngestJobResponse(**j) for j in jobs]


@router.get("/status/{job_id}", response_model=IngestJobResponse, summary="Get status of an ingest job")
async def get_job_status(job_id: str):
    """Retrieve progress and details of a specific video ingestion job."""
    if job_id not in _INGEST_JOBS:
        raise HTTPException(status_code=404, detail=f"Ingest job '{job_id}' not found.")
    return IngestJobResponse(**_INGEST_JOBS[job_id])
