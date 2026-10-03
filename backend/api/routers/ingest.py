"""
Ingest router — video upload and job status.

POST /api/ingest                — upload a video for background processing
GET  /api/ingest/jobs           — list all jobs
GET  /api/ingest/status/{id}    — check one job's progress
"""
from __future__ import annotations

import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

import psycopg2
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["Ingestion"])

# ── Sync DB helper (psycopg2, same as ingest_worker) ────────────────────────
_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")


def _get_conn():
    return psycopg2.connect(_db_url)


# ── Response schema ──────────────────────────────────────────────────────────

class IngestJobResponse(BaseModel):
    job_id: str
    filename: str
    camera_id: str
    status: str
    progress_percent: float = 0.0
    frames_processed: int = 0
    persons_found: int = 0
    sightings_added: int = 0
    recorded_at: Optional[str] = None
    created_at: Optional[str] = None
    error: Optional[str] = None


# ── Upload endpoint ──────────────────────────────────────────────────────────

@router.post("", response_model=IngestJobResponse, summary="Upload video for background ingestion")
def upload_video(
    video: UploadFile = File(..., description="Video file (.mp4, .avi, .mkv, .mov, .webm)"),
    camera_id: str = Form("default_cam"),
    recorded_at: Optional[str] = Form(None),
):
    """
    Accepts a video upload, saves it to data/ingest/, and queues an ingest job.
    The background ingest_worker will pick it up and process it automatically.
    """
    if not video.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No video file provided.")

    # Validate extension
    ext = os.path.splitext(video.filename)[1].lower()
    if ext not in {".mp4", ".avi", ".mov", ".mkv", ".webm"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported video format '{ext}'. Allowed: .mp4, .avi, .mov, .mkv, .webm",
        )

    # Parse recorded_at
    rec_dt: Optional[datetime] = None
    if recorded_at:
        try:
            rec_dt = datetime.fromisoformat(recorded_at)
            if rec_dt.tzinfo is None:
                rec_dt = rec_dt.replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid recorded_at format. Use ISO 8601: 2026-09-05T12:00:00",
            )

    # Save file (use absolute path so the worker can find it regardless of CWD)
    ingest_dir = os.path.abspath(settings.ingest_dir)
    os.makedirs(ingest_dir, exist_ok=True)
    job_id = uuid.uuid4().hex[:12]
    video_path = os.path.join(ingest_dir, f"{job_id}{ext}")

    with open(video_path, "wb") as f:
        while True:
            chunk = video.file.read(1024 * 1024)  # 1 MB chunks
            if not chunk:
                break
            f.write(chunk)

    file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
    logger.info(
        "Video uploaded: job=%s file=%s (%.1f MB) camera=%s"
        % (job_id, video.filename, file_size_mb, camera_id)
    )

    # Insert into DB
    try:
        conn = _get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ingest_jobs
                    (id, original_name, video_path, camera_id, recorded_at, status, created_at)
                VALUES (%s, %s, %s, %s, %s, 'queued', now())
                """,
                (job_id, video.filename, video_path, camera_id, rec_dt),
            )
        conn.commit()
        conn.close()
    except Exception as exc:
        # Clean up uploaded file if DB insert fails
        if os.path.exists(video_path):
            os.remove(video_path)
        logger.error("Failed to queue ingest job: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue job: {exc}",
        )

    return IngestJobResponse(
        job_id=job_id,
        filename=video.filename,
        camera_id=camera_id,
        status="queued",
        progress_percent=0.0,
        recorded_at=rec_dt.isoformat() if rec_dt else None,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


# ── List jobs ────────────────────────────────────────────────────────────────

@router.get("/jobs", summary="List all ingest jobs")
def list_jobs():
    """Returns all ingest jobs sorted newest-first."""
    try:
        conn = _get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, original_name, camera_id, recorded_at,
                       total_frames, processed_frame, status,
                       persons_found, sightings_added, created_at, error
                FROM ingest_jobs
                ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()
        conn.close()
    except Exception as exc:
        logger.error("Failed to fetch ingest jobs: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    jobs = []
    for row in rows:
        total = row[4] or 0
        processed = row[5] or 0
        progress = round(processed / total * 100, 1) if total > 0 else 0.0
        jobs.append(IngestJobResponse(
            job_id=row[0],
            filename=row[1] or "",
            camera_id=row[2],
            status=row[6],
            progress_percent=progress,
            frames_processed=processed,
            persons_found=row[7] or 0,
            sightings_added=row[8] or 0,
            recorded_at=row[3].isoformat() if row[3] else None,
            created_at=row[9].isoformat() if row[9] else None,
            error=row[10],
        ))
    return jobs


# ── Job status ───────────────────────────────────────────────────────────────

@router.get("/status/{job_id}", response_model=IngestJobResponse, summary="Get ingest job status")
def get_job_status(job_id: str):
    """Retrieve progress and details of a specific ingest job."""
    try:
        conn = _get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, original_name, camera_id, recorded_at, fps,
                       total_frames, processed_frame, status, error,
                       persons_found, sightings_added, created_at
                FROM ingest_jobs WHERE id = %s
                """,
                (job_id,),
            )
            row = cur.fetchone()
        conn.close()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    if not row:
        raise HTTPException(status_code=404, detail=f"Ingest job '{job_id}' not found.")

    total = row[5] or 0
    processed = row[6] or 0
    progress = round(processed / total * 100, 1) if total > 0 else 0.0

    return IngestJobResponse(
        job_id=row[0],
        filename=row[1] or "",
        camera_id=row[2],
        status=row[7],
        progress_percent=progress,
        frames_processed=processed,
        persons_found=row[9] or 0,
        sightings_added=row[10] or 0,
        recorded_at=row[3].isoformat() if row[3] else None,
        created_at=row[11].isoformat() if row[11] else None,
        error=row[8],
    )
