"""
Ingest worker. Processes uploaded videos in chunks with resume.
Run as: python -m pipeline.ingest_worker

Reads every frame (cheap at 720p), processes every Nth (FPS sampling).
No grab() — OpenCV's mp4v codec makes grab() as slow as read().
"""
import os
import time
import logging
import traceback
import cv2
import psycopg2
from sources.file import FileSource
from pipeline.detector import Detector
from pipeline.quality import filter_detections
from pipeline.tracker import Tracker
from pipeline.embedder import Embedder
from pipeline import matcher, cooldown, retention
from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")


def get_connection():
    return psycopg2.connect(_db_url)


def pick_next_job(conn) -> dict | None:
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
            "id": row[0], "video_path": row[1], "camera_id": row[2],
            "recorded_at": row[3], "fps": row[4],
            "total_frames": row[5], "processed_frame": row[6] or 0,
        }


def process_job(job: dict, detector: Detector, embedder: Embedder) -> None:
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

        # Set video metadata
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

        video_fps = source.fps or 25

        # Process every Nth frame. Read all, skip processing on the rest.
        # At 720p read() is ~5ms. No grab() — mp4v codec makes it equally slow.
        sample_every = max(1, int(video_fps / settings.fps_sample_rate))
        logger.info(
            "Video: %.0ffps, %dx%d, %d frames | Processing every %dth frame"
            % (video_fps, source._total_frames, source._total_frames,
               source.total_frames, sample_every)
        )

        chunk_frames = int(settings.chunk_duration_minutes * 60 * video_fps)
        chunk_start = source.current_frame

        tracker = Tracker()
        detect_count = 0
        persons_found = set()
        sightings_added = 0
        frames_read = 0
        frames_processed = 0
        last_log_time = time.time()

        while True:
            ok, frame, timestamp = source.read()
            if not ok:
                sightings_added += _flush_tracks(
                    tracker, embedder, job["camera_id"], conn, job_id, persons_found
                )
                break

            frames_read += 1

            # Skip non-sampled frames
            if frames_read % sample_every != 0:
                continue

            # Resize if needed
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
                if _process_track(track, embedder, job["camera_id"], conn, job_id, persons_found):
                    sightings_added += 1

            # Log every 10 seconds
            now = time.time()
            if now - last_log_time >= 10:
                total = job["total_frames"] or 1
                logger.info(
                    "Progress: %d/%d frames (%.1f%%) | processed %d | %d persons | %d sightings"
                    % (frames_read, total, frames_read / total * 100,
                       frames_processed, len(persons_found), sightings_added)
                )
                last_log_time = now

            # Chunk boundary
            current = source.current_frame
            if current - chunk_start >= chunk_frames:
                sightings_added += _flush_tracks(
                    tracker, embedder, job["camera_id"], conn, job_id, persons_found
                )
                tracker = Tracker()
                _update_progress(conn, job_id, current, len(persons_found), sightings_added)

                total = job["total_frames"] or 1
                logger.info(
                    "CHUNK DONE: %d/%d (%.1f%%) — %d persons, %d sightings"
                    % (current, total, current / total * 100,
                       len(persons_found), sightings_added)
                )
                chunk_start = current

        # Complete
        total = job["total_frames"] or source.current_frame
        _update_progress(conn, job_id, total, len(persons_found), sightings_added)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE ingest_jobs SET status = 'complete' WHERE id = %s",
                (job_id,),
            )
        conn.commit()
        source.release()

        if os.path.exists(job["video_path"]):
            os.remove(job["video_path"])

        logger.info(
            "JOB COMPLETE: %d frames read, %d processed, %d persons, %d sightings"
            % (frames_read, frames_processed, len(persons_found), sightings_added)
        )

    except Exception as e:
        logger.error("Job %s failed: %s" % (job_id, e), exc_info=True)
        try:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ingest_jobs SET status = 'failed', error = %s WHERE id = %s",
                    (traceback.format_exc()[:1000], job_id),
                )
            conn.commit()
        except Exception:
            logger.error("Could not update job status to failed")
    finally:
        conn.close()


def _process_track(track, embedder, camera_id, conn, job_id, persons_found) -> bool:
    try:
        embedding = embedder.embed(track.crops)
        person_id = matcher.match_or_create(embedding, track.best_crop.timestamp)
        persons_found.add(person_id)
        should_insert = cooldown.check(person_id, camera_id, track.best_crop.timestamp, conn)
        if should_insert:
            retention.handle(
                person_id=person_id, embedding=embedding, crop_info=track.best_crop,
                camera_id=camera_id, timestamp=track.best_crop.timestamp,
                conn=conn, job_id=job_id,
            )
            return True
        return False
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("Track %d failed: %s" % (track.track_id, e), exc_info=True)
        return False


def _flush_tracks(tracker, embedder, camera_id, conn, job_id, persons_found) -> int:
    count = 0
    for track in [t for t in tracker.active_tracks if len(t.crops) > 0]:
        if _process_track(track, embedder, camera_id, conn, job_id, persons_found):
            count += 1
    return count


def _update_progress(conn, job_id, processed_frame, persons_found, sightings_added):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE ingest_jobs SET processed_frame=%s, persons_found=%s, sightings_added=%s WHERE id=%s",
            (processed_frame, persons_found, sightings_added, job_id),
        )
    conn.commit()


def run():
    logger.info("Ingest worker starting...")
    logger.info("  Chunk duration: %d minutes" % settings.chunk_duration_minutes)
    logger.info("  FPS sample rate: %d" % settings.fps_sample_rate)

    detector = Detector()
    embedder = Embedder()
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