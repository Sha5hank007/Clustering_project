"""
Main ingestion loop. Entry point: python -m pipeline.worker

Full pipeline:
  source → detector → quality → tracker → embedder → matcher → cooldown → retention → DB

When DEBUG_DISPLAY=true, shows a live window with bounding boxes,
track IDs, person IDs, and FPS. Press 'q' to quit.
"""
import sys
import time
import logging
import cv2
import numpy as np
from sources.factory import create_source
from pipeline.detector import Detector
from pipeline.quality import filter_detections
from pipeline.tracker import Tracker, Track
from pipeline.embedder import Embedder
from pipeline import matcher, cooldown, retention
from config import settings

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


def process_dead_track(track: Track, embedder: Embedder) -> None:
    """
    Full processing of a dead track:
    embed → match → cooldown → retention
    """
    try:
        # Step 1: Embed — align + ArcFace on best crops → 512-d vector
        embedding = embedder.embed(track.crops)

        # Step 2: Match — cosine search against persons table
        conn = matcher.get_connection()
        try:
            person_id = matcher.match_or_create(embedding, track.best_crop.timestamp)

            # Step 3: Cooldown — was this person seen recently on this camera?
            should_insert = cooldown.check(
                person_id, settings.camera_id, track.best_crop.timestamp, conn
            )

            # Step 4: Retention — insert sighting row, maybe save crop
            if should_insert:
                retention.handle(
                    person_id=person_id,
                    embedding=embedding,
                    crop_info=track.best_crop,
                    camera_id=settings.camera_id,
                    timestamp=track.best_crop.timestamp,
                    conn=conn,
                )
            else:
                logger.info(
                    f"Track {track.track_id} → person {person_id} "
                    f"(within cooldown, no sighting row)"
                )
        finally:
            conn.close()

    except Exception as e:
        logger.error(f"Failed processing track {track.track_id}: {e}", exc_info=True)


def draw_debug(
    frame: np.ndarray,
    tracker: Tracker,
    fps: float,
    detections_this_frame: int,
) -> np.ndarray:
    """Draw tracking info on frame for debug display."""
    display = frame.copy()

    for track in tracker.active_tracks:
        # Don't draw dying tracks — they have no confirmed position
        if track.misses > 2:
            continue

        bbox = track.bbox.astype(int)
        x1, y1, x2, y2 = bbox

        color = (0, 255, 0) if track.misses == 0 else (0, 255, 255)
        cv2.rectangle(display, (x1, y1), (x2, y2), color, 2)

        label = f"T:{track.track_id}"
        if track.crops:
            label += f" Q:{track.best_crop.quality_score:.2f}"

        cv2.putText(
            display, label,
            (x1, y1 - 10),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1,
        )

    cv2.putText(
        display,
        f"FPS: {fps:.1f} | Tracks: {len(tracker.active_tracks)} | Dets: {detections_this_frame}",
        (10, 25),
        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2,
    )

    return display


def run() -> None:
    logger.info("=" * 50)
    logger.info("Starting Face Track ingestion worker")
    logger.info(f"  Camera: {settings.camera_source}")
    logger.info(f"  Camera ID: {settings.camera_id}")
    logger.info(f"  Detector: {settings.detector_model}")
    logger.info(f"  Recognizer: {settings.recognizer_model}")
    logger.info(f"  Det size: {settings.det_size_tuple}")
    logger.info(f"  Detect interval: {settings.detect_interval}")
    logger.info(f"  Cooldown: {settings.cooldown_hours}h")
    logger.info(f"  Debug display: {settings.debug_display}")
    logger.info("=" * 50)

    # ── Initialize ──
    source = create_source()
    detector = Detector()
    embedder = Embedder()
    tracker = Tracker()

    frame_count = 0
    detect_count = 0
    fps_timer = time.time()
    fps = 0.0
    frame_interval = 1.0 / settings.fps_sample_rate
    last_frame_time = 0.0
    detections_this_frame = 0
    total_tracks_processed = 0

    logger.info("Pipeline ready. Processing frames...")

    try:
        while True:
            ok, frame, timestamp = source.read()

            if not ok:
                logger.warning("Frame source returned not ok. Retrying...")
                time.sleep(0.1)
                continue

            # ── FPS throttle ──
            if timestamp - last_frame_time < frame_interval:
                continue
            last_frame_time = timestamp

            # ── Downscale high-res frames ──
            # 4K video at 640×640 detection = faces too small to detect.
            # Cap frame at 1920px wide — detection, tracking, and crops
            # all work on the downscaled frame. No information loss for
            # face recognition (112×112 aligned crops don't need 4K).
            h, w = frame.shape[:2]
            if w > 1920:
                scale = 1920 / w
                frame = cv2.resize(frame, (1920, int(h * scale)))

            frame_count += 1
            detect_count += 1
            dead_tracks = []

            if detect_count % settings.detect_interval == 0:
                # ── Detection frame ──
                raw_detections = detector.detect(frame, timestamp)
                filtered = filter_detections(raw_detections, frame)
                dead_tracks = tracker.update(filtered, frame)
                detections_this_frame = len(filtered)
                if raw_detections and not filtered:
                    logger.debug(
                        f"All {len(raw_detections)} detections rejected by quality gate"
                    )
                elif raw_detections:
                    logger.debug(
                        f"Detections: {len(raw_detections)} raw → {len(filtered)} passed quality"
                    )
            else:
                # ── Skip frame: predict only ──
                dead_tracks = tracker.predict()

            # ── Process dead tracks → embed → match → DB ──
            for track in dead_tracks:
                process_dead_track(track, embedder)
                total_tracks_processed += 1

            # ── FPS calculation ──
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                fps = frame_count / elapsed
                frame_count = 0
                fps_timer = time.time()

            # ── Debug display ──
            if settings.debug_display:
                display = draw_debug(frame, tracker, fps, detections_this_frame)
                # Resize to fit screen — cap width at 1280px
                h, w = display.shape[:2]
                if w > 1280:
                    scale = 1280 / w
                    display = cv2.resize(display, (1280, int(h * scale)))
                cv2.imshow("Face Track — press q to quit", display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    logger.info("Quit signal received.")
                    break

    except KeyboardInterrupt:
        logger.info("Interrupted by user.")
    finally:
        # ── Flush surviving tracks — don't lose data on shutdown ──
        surviving = [t for t in tracker.active_tracks if len(t.crops) > 0]
        if surviving:
            logger.info(f"Processing {len(surviving)} surviving tracks before exit...")
            for track in surviving:
                process_dead_track(track, embedder)
                total_tracks_processed += 1

        source.release()
        if settings.debug_display:
            cv2.destroyAllWindows()
        logger.info(f"Worker stopped. Total tracks processed: {total_tracks_processed}")


if __name__ == "__main__":
    run()