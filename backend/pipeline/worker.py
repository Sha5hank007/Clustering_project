"""
Main ingestion loop. Entry point: python -m pipeline.worker

Ties together: source → detector → quality → tracker
Outputs dead tracks for Person B's embedding/matching pipeline.

When DEBUG_DISPLAY=true in .env, shows a live window with:
  - Green boxes around tracked faces
  - Track IDs
  - Quality scores
  - FPS counter

Press 'q' to quit when debug display is on.
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
from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


def process_dead_track(track: Track) -> None:
    """
    Called when a track dies. This is the handoff point to Person B's code.

    Person B will replace this with:
        embedding = embedder.embed(track.crops)
        person_id = matcher.match_or_create(embedding, timestamp)
        should_insert = cooldown.check(person_id, camera_id, timestamp)
        if should_insert:
            retention.handle(person_id, track.best_crop, timestamp)
    """
    best = track.best_crop
    logger.info(
        f"Track {track.track_id} died | "
        f"age={track.age} frames | "
        f"crops={len(track.crops)} | "
        f"best_quality={best.quality_score:.3f}"
    )


def draw_debug(
    frame: np.ndarray,
    tracker: Tracker,
    fps: float,
    detections_this_frame: int,
) -> np.ndarray:
    """Draw tracking info on frame for debug display."""
    display = frame.copy()

    for track in tracker.active_tracks:
        bbox = track.bbox.astype(int)
        x1, y1, x2, y2 = bbox

        # Green box for active tracks, yellow for tracks with misses
        color = (0, 255, 0) if track.misses == 0 else (0, 255, 255)
        cv2.rectangle(display, (x1, y1), (x2, y2), color, 2)

        # Track ID and quality
        label = f"ID:{track.track_id}"
        if track.crops:
            label += f" Q:{track.best_crop.quality_score:.2f}"

        cv2.putText(
            display, label,
            (x1, y1 - 10),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1,
        )

    # FPS and stats in top-left
    cv2.putText(
        display,
        f"FPS: {fps:.1f} | Tracks: {len(tracker.active_tracks)} | Dets: {detections_this_frame}",
        (10, 25),
        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2,
    )

    return display


def run() -> None:
    logger.info("Starting ingestion worker")
    logger.info(f"Camera source: {settings.camera_source}")
    logger.info(f"Detector model: {settings.detector_model}")
    logger.info(f"Det size: {settings.det_size_tuple}")
    logger.info(f"Detect interval: {settings.detect_interval}")
    logger.info(f"Debug display: {settings.debug_display}")

    # ── Initialize ──
    source = create_source()
    detector = Detector()
    tracker = Tracker()

    frame_count = 0
    fps_timer = time.time()
    fps = 0.0
    frame_interval = 1.0 / settings.fps_sample_rate
    last_frame_time = 0.0
    detections_this_frame = 0

    logger.info("Pipeline ready. Processing frames...")

    try:
        while True:
            ok, frame, timestamp = source.read()

            if not ok:
                logger.warning("Frame source returned not ok. Retrying...")
                time.sleep(0.1)
                continue

            # ── FPS throttle ──
            # Skip frames if camera produces faster than FPS_SAMPLE_RATE
            if timestamp - last_frame_time < frame_interval:
                continue
            last_frame_time = timestamp

            frame_count += 1
            dead_tracks = []

            if frame_count % settings.detect_interval == 0:
                # ── Detection frame ──
                raw_detections = detector.detect(frame, timestamp)
                filtered = filter_detections(raw_detections, frame)
                dead_tracks = tracker.update(filtered, frame)
                detections_this_frame = len(filtered)
            else:
                # ── Skip frame: predict only ──
                dead_tracks = tracker.predict()

            # ── Handle dead tracks ──
            for track in dead_tracks:
                process_dead_track(track)

            # ── FPS calculation ──
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                fps = frame_count / elapsed
                frame_count = 0
                fps_timer = time.time()

            # ── Debug display ──
            if settings.debug_display:
                display = draw_debug(frame, tracker, fps, detections_this_frame)
                cv2.imshow("Face Track — press q to quit", display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    logger.info("Quit signal received.")
                    break

    except KeyboardInterrupt:
        logger.info("Interrupted by user.")
    finally:
        source.release()
        if settings.debug_display:
            cv2.destroyAllWindows()
        logger.info("Worker stopped.")


if __name__ == "__main__":
    run()