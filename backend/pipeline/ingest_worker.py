"""
Ingest worker. Processes uploaded videos in chunks with resume support.
Run as: python -m pipeline.ingest_worker

Polls the `ingest_jobs` table for queued/interrupted jobs and processes
them one at a time, checkpointing every chunk so a crash is resumable.

Reads every frame (cheap at 720p) but only runs detection on every Nth
frame (FPS sampling via settings.fps_sample_rate).
"""
import os
import time
import logging
import traceback
from datetime import datetime, timezone

import cv2
import psycopg2

from sources.file import FileSource
from pipeline.detector import Detector
from pipeline.embedder import FaceEmbedder
from pipeline.quality import filter_detections
from pipeline.tracker import Tracker
from pipeline.matcher import match_or_create, insert_sighting
from pipeline.cooldown import should_insert_sighting
from pipeline.retention import save_best_crop
from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Convert asyncpg URL to psycopg2-compatible URL for sync DB access
_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")


def get_connection():
    """Open a synchronous psycopg2 connection."""
    return psycopg2.connect(_db_url)


# ---------------------------------------------------------------------------
# Job polling
# ---------------------------------------------------------------------------

def pick_next_job(conn) -> dict | None:
    """
    Atomically claim the next queued (or previously-interrupted processing)
    job. Uses FOR UPDATE SKIP LOCKED so multiple workers don't step on each
    other.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, video_path, camera_id, recorded_at,
                   fps, total_frames, processed_frame
            FROM ingest_jobs
            WHERE status IN ('processing', 'queued')
            ORDER BY
                CASE WHEN status = 'processing' THEN 0 ELSE 1 END,
                created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """,
        )
        row = cur.fetchone()
        if not row:
            return None

        cur.execute(
            "UPDATE ingest_jobs SET status = 'processing' WHERE id = %s",
            (row[0],),
        )
        conn.commit()

        return {
            "id": row[0],
            "video_path": row[1],
            "camera_id": row[2],
            "recorded_at": row[3],
            "fps": row[4],
            "total_frames": row[5],
            "processed_frame": row[6] or 0,
        }


# ---------------------------------------------------------------------------
# Track processing helpers (use Vaibhav branch's existing pipeline API)
# ---------------------------------------------------------------------------

def _process_track(track, embedder: FaceEmbedder, camera_id: str, job_id: str, persons_found: set) -> bool:
    """
    Embed a dead track, match/create a person identity, apply cooldown, and
    insert a sighting. Returns True if a sighting was inserted.
    """
    try:
        if not track.crops:
            return False

        embedding = embedder.embed_track(track)
        best = track.best_crop
        if best is None:
            return False

        seen_at = datetime.fromtimestamp(best.timestamp, tz=timezone.utc)
        person_id = match_or_create(embedding, seen_at)
        persons_found.add(person_id)

        should_insert = should_insert_sighting(person_id, camera_id, seen_at)
        if should_insert:
            crop_path = save_best_crop(
                person_id=person_id,
                crop=best.crop,
                seen_at=seen_at,
                quality_score=float(best.quality_score),
            )
            insert_sighting(
                person_id=person_id,
                camera_id=camera_id,
                seen_at=seen_at,
                embedding=embedding,
                quality_score=float(best.quality_score),
                crop_path=crop_path,
                bbox=best.bbox.astype(float).tolist() if best.bbox is not None else None,
            )
            return True
        return False

    except Exception as e:
        logger.error("Track %s failed: %s" % (track.track_id, e), exc_info=True)
        return False


def _flush_tracks(tracker: Tracker, embedder: FaceEmbedder, camera_id: str, job_id: str, persons_found: set) -> int:
    """Flush all active tracks with crops and return count of sightings inserted."""
    count = 0
    for track in list(tracker.active_tracks):
        if track.crops:
            if _process_track(track, embedder, camera_id, job_id, persons_found):
                count += 1
    return count


def _update_progress(conn, job_id: str, processed_frame: int, persons_found: int, sightings_added: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE ingest_jobs SET processed_frame=%s, persons_found=%s, sightings_added=%s WHERE id=%s",
            (processed_frame, persons_found, sightings_added, job_id),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Main job processor
# ---------------------------------------------------------------------------

def process_job(job: dict, detector: Detector, embedder: FaceEmbedder) -> None:
    job_id = job["id"]
    conn = get_connection()

    logger.info(
        "Processing job %s: %s (camera=%s, resume from frame %d)"
        % (job_id, job["video_path"], job["camera_id"], job["processed_frame"])
    )

    try:
        source = FileSource(
            path=job["video_path"],
            loop=False,
            recorded_at=job["recorded_at"],
        )

        # Store video metadata on first run
        if job["fps"] is None:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ingest_jobs SET fps = %s, total_frames = %s WHERE id = %s",
                    (source.fps, source.total_frames, job_id),
                )
            conn.commit()
            job["fps"] = source.fps
            job["total_frames"] = source.total_frames

        # Resume from last checkpoint
        if job["processed_frame"] > 0:
            source.seek_to_frame(job["processed_frame"])
            logger.info("Resumed from frame %d" % job["processed_frame"])

        video_fps = source.fps or 25.0
        sample_every = max(1, int(video_fps / settings.fps_sample_rate))
        chunk_frames = int(settings.chunk_duration_minutes * 60 * video_fps)
        chunk_start = source.current_frame

        logger.info(
            "Video: %.0ffps, %d total frames | Processing every %dth frame | Chunk size: %d frames"
            % (video_fps, source.total_frames, sample_every, chunk_frames)
        )

        tracker = Tracker()
        detect_count = 0
        persons_found: set = set()
        sightings_added = 0
        frames_read = 0
        frames_processed = 0
        last_log_time = time.time()

        while True:
            ok, frame, timestamp = source.read()
            if not ok:
                # End of video — flush remaining active tracks
                sightings_added += _flush_tracks(tracker, embedder, job["camera_id"], job_id, persons_found)
                break

            frames_read += 1

            # FPS sampling: only process every Nth frame
            if frames_read % sample_every != 0:
                continue

            # Resize large frames for faster detection
            h, w = frame.shape[:2]
            if w > 1280:
                scale = 1280 / w
                frame = cv2.resize(frame, (1280, int(h * scale)))

            detect_count += 1
            frames_processed += 1
            dead_tracks = []

            if detect_count % settings.detect_interval == 0:
                raw_detections = detector.detect(frame, timestamp)
                filtered = filter_detections(raw_detections, frame)
                dead_tracks = tracker.update(filtered, frame)
            else:
                dead_tracks = tracker.predict()

            for track in dead_tracks:
                if _process_track(track, embedder, job["camera_id"], job_id, persons_found):
                    sightings_added += 1

            # Periodic progress log every 10 seconds
            now = time.time()
            if now - last_log_time >= 10:
                total = job["total_frames"] or 1
                logger.info(
                    "Progress: %d/%d frames (%.1f%%) | processed %d | %d persons | %d sightings"
                    % (frames_read, total, frames_read / total * 100,
                       frames_processed, len(persons_found), sightings_added)
                )
                last_log_time = now

            # Chunk boundary checkpoint
            current = source.current_frame
            if current - chunk_start >= chunk_frames:
                sightings_added += _flush_tracks(tracker, embedder, job["camera_id"], job_id, persons_found)
                tracker = Tracker()
                _update_progress(conn, job_id, current, len(persons_found), sightings_added)

                total = job["total_frames"] or 1
                logger.info(
                    "CHUNK DONE: %d/%d (%.1f%%) — %d persons, %d sightings"
                    % (current, total, current / total * 100, len(persons_found), sightings_added)
                )
                chunk_start = current

        # Mark job complete
        total = job["total_frames"] or source.current_frame
        _update_progress(conn, job_id, total, len(persons_found), sightings_added)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE ingest_jobs SET status = 'complete' WHERE id = %s",
                (job_id,),
            )
        conn.commit()
        source.release()

        # Clean up uploaded video file after successful processing
        if os.path.exists(job["video_path"]):
            os.remove(job["video_path"])
            logger.info("Deleted processed video: %s" % job["video_path"])

        logger.info(
            "JOB COMPLETE %s: %d frames read, %d processed, %d persons, %d sightings"
            % (job_id, frames_read, frames_processed, len(persons_found), sightings_added)
        )

    except Exception as e:
        logger.error("Job %s failed: %s" % (job_id, e), exc_info=True)
        try:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ingest_jobs SET status = 'failed', error = %s WHERE id = %s",
                    (traceback.format_exc()[:2000], job_id),
                )
            conn.commit()
        except Exception:
            logger.error("Could not update job status to failed")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run() -> None:
    logger.info("Ingest worker starting...")
    logger.info("  Chunk duration: %d minutes" % settings.chunk_duration_minutes)
    logger.info("  FPS sample rate: %d fps" % settings.fps_sample_rate)

    detector = Detector()
    embedder = FaceEmbedder()
    logger.info("Models loaded. Polling for jobs...")

    while True:
        conn = get_connection()
        try:
            job = pick_next_job(conn)
        finally:
            conn.close()

        if job:
            process_job(job, detector, embedder)
        else:
            time.sleep(2)


if __name__ == "__main__":
    run()
