"""
Stream worker. Processes live RTSP camera feeds.
Run as: python -m pipeline.stream_worker

Polls live_streams table for streams with status='running'.
Connects to the RTSP URL, processes frames through the same
detect → track → embed → match → store pipeline.

Checks stream status every 30 seconds. Stops when paused/stopped.
Handles disconnection via RTSPSource's built-in reconnect logic.
"""
import time
import logging
import cv2
import psycopg2
from sources.rtsp import RTSPSource
from sources.webcam import WebcamSource
from sources.base import FrameSource
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

STATUS_CHECK_INTERVAL = 30  # seconds between DB status checks


def get_connection():
    return psycopg2.connect(_db_url)


def pick_stream(conn) -> dict | None:
    """
    Find a running stream that no other worker is processing.
    FOR UPDATE SKIP LOCKED prevents two workers from grabbing the same stream.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, shop_id, url, camera_id, name,
                   persons_found, sightings_added
            FROM live_streams
            WHERE status = 'running'
            ORDER BY started_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """,
        )
        row = cur.fetchone()
        if not row:
            return None

        return {
            "id": row[0],
            "shop_id": row[1],
            "url": row[2],
            "camera_id": row[3],
            "name": row[4],
            "persons_found": row[5] or 0,
            "sightings_added": row[6] or 0,
        }


def create_source(url: str) -> FrameSource:
    """
    Create the right frame source based on URL.
    Supports rtsp:// for real cameras and webcam://N for testing.
    """
    if url.startswith("webcam://"):
        device_id = int(url.replace("webcam://", ""))
        logger.info("Opening webcam device %d" % device_id)
        return WebcamSource(device_id)
    elif url.startswith("rtsp://"):
        return RTSPSource(url)
    else:
        raise ValueError("Unsupported stream URL: %s (use rtsp:// or webcam://)" % url)


def process_stream(
    stream: dict, detector: Detector, embedder: Embedder
) -> None:
    """
    Process a live stream until it's paused, stopped, or disconnected.
    """
    stream_id = stream["id"]
    shop_id = stream["shop_id"]
    camera_id = stream["camera_id"]

    logger.info(
        "Connecting to stream %s: %s (camera=%s, shop=%d)"
        % (stream_id, stream["url"], camera_id, shop_id)
    )

    conn = get_connection()

    try:
        source = create_source(stream["url"])
    except Exception as e:
        logger.error("Cannot connect to stream %s: %s" % (stream_id, e))
        # Mark as failed but don't stop — might be temporary
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE live_streams SET status = 'stopped', stopped_at = now() WHERE id = %s",
                (stream_id,),
            )
        conn.commit()
        conn.close()
        return

    logger.info("Stream %s connected. Processing frames..." % stream_id)

    tracker = Tracker()
    detect_count = 0
    frame_count = 0
    persons_found = set()
    sightings_added = stream["sightings_added"]
    last_status_check = time.time()
    last_stats_update = time.time()
    frame_interval = 1.0 / settings.fps_sample_rate
    last_frame_time = 0.0
    consecutive_failures = 0
    max_failures = 100  # stop after 100 consecutive failed reads

    try:
        while True:
            ok, frame, timestamp = source.read()

            if not ok:
                consecutive_failures += 1
                if consecutive_failures > max_failures:
                    logger.error("Stream %s: %d consecutive failures, stopping" % (
                        stream_id, max_failures))
                    break
                time.sleep(0.1)
                continue

            consecutive_failures = 0

            # FPS throttle
            if timestamp - last_frame_time < frame_interval:
                continue
            last_frame_time = timestamp

            # Downscale if needed
            h, w = frame.shape[:2]
            if w > 1280:
                scale = 1280 / w
                frame = cv2.resize(frame, (1280, int(h * scale)))

            frame_count += 1
            detect_count += 1
            dead_tracks = []

            if detect_count % settings.detect_interval == 0:
                raw_detections = detector.detect(frame, timestamp)
                filtered = filter_detections(raw_detections, frame)
                dead_tracks = tracker.update(filtered, frame)
            else:
                dead_tracks = tracker.predict()

            # Process dead tracks
            for track in dead_tracks:
                if _process_track(
                    track, embedder, camera_id, conn,
                    stream_id, shop_id, persons_found
                ):
                    sightings_added += 1

            # Check stream status every 30 seconds
            now = time.time()
            if now - last_status_check >= STATUS_CHECK_INTERVAL:
                last_status_check = now

                status = _check_status(conn, stream_id)
                if status != "running":
                    logger.info("Stream %s status changed to '%s', stopping" % (stream_id, status))
                    # Flush remaining tracks
                    sightings_added += _flush_tracks(
                        tracker, embedder, camera_id, conn,
                        stream_id, shop_id, persons_found
                    )
                    break

                logger.info(
                    "Stream %s alive: %d frames, %d persons, %d sightings"
                    % (stream_id, frame_count, len(persons_found), sightings_added)
                )

            # Update stats in DB every 60 seconds
            if now - last_stats_update >= 60:
                last_stats_update = now
                _update_stats(conn, stream_id, len(persons_found), sightings_added)

    except KeyboardInterrupt:
        logger.info("Stream %s interrupted by user" % stream_id)
    except Exception as e:
        logger.error("Stream %s error: %s" % (stream_id, e), exc_info=True)
    finally:
        # Flush remaining tracks
        try:
            sightings_added += _flush_tracks(
                tracker, embedder, camera_id, conn,
                stream_id, shop_id, persons_found
            )
            _update_stats(conn, stream_id, len(persons_found), sightings_added)
        except Exception:
            pass

        source.release()
        conn.close()
        logger.info(
            "Stream %s disconnected: %d frames, %d persons, %d sightings"
            % (stream_id, frame_count, len(persons_found), sightings_added)
        )


def _process_track(track, embedder, camera_id, conn, stream_id, shop_id, persons_found) -> bool:
    try:
        embedding = embedder.embed(track.crops)
        person_id = matcher.match_or_create(embedding, track.best_crop.timestamp, shop_id)
        persons_found.add(person_id)
        should_insert = cooldown.check(person_id, camera_id, track.best_crop.timestamp, conn)
        if should_insert:
            retention.handle(
                person_id=person_id, embedding=embedding, crop_info=track.best_crop,
                camera_id=camera_id, timestamp=track.best_crop.timestamp,
                conn=conn, shop_id=shop_id, stream_id=stream_id,
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


def _flush_tracks(tracker, embedder, camera_id, conn, stream_id, shop_id, persons_found) -> int:
    count = 0
    for track in [t for t in tracker.active_tracks if len(t.crops) > 0]:
        if _process_track(track, embedder, camera_id, conn, stream_id, shop_id, persons_found):
            count += 1
    return count


def _check_status(conn, stream_id) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT status FROM live_streams WHERE id = %s", (stream_id,))
        row = cur.fetchone()
        return row[0] if row else "stopped"


def _update_stats(conn, stream_id, persons_found, sightings_added):
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE live_streams SET persons_found = %s, sightings_added = %s WHERE id = %s",
                (persons_found, sightings_added, stream_id),
            )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def run():
    logger.info("Stream worker starting...")
    logger.info("  FPS sample rate: %d" % settings.fps_sample_rate)
    logger.info("  Status check interval: %ds" % STATUS_CHECK_INTERVAL)

    detector = Detector()
    embedder = Embedder()
    logger.info("Models loaded. Polling for streams...")

    while True:
        conn = get_connection()
        try:
            stream = pick_stream(conn)
        finally:
            conn.close()

        if stream:
            process_stream(stream, detector, embedder)
        else:
            time.sleep(5)


if __name__ == "__main__":
    run()