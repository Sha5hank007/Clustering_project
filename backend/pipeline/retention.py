"""
Image retention policy + sighting insertion.

Controls which sightings get a saved face crop on disk.
Rule: one best crop per person per RETENTION_WINDOW_DAYS.

Also handles the actual INSERT into the sightings table.
"""
import os
import logging
from datetime import datetime, timezone
import cv2
import numpy as np
import psycopg2
from pipeline.tracker import CropInfo
from config import settings

logger = logging.getLogger(__name__)


def handle(
    person_id: int,
    embedding: np.ndarray,
    crop_info: CropInfo,
    camera_id: str,
    timestamp: float,
    conn,
) -> None:
    """
    Insert a sighting row and optionally save a face crop to disk.

    Args:
        person_id: matched person
        embedding: 512-d vector for this track
        crop_info: best crop from the track
        camera_id: which camera
        timestamp: when
        conn: psycopg2 connection
    """
    # Determine date bucket
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    bucket = dt.toordinal() // settings.retention_window_days

    # Check if a crop already exists for this person in this bucket
    crop_path = None
    should_save = False

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, crop_path, quality_score FROM sightings
            WHERE person_id = %s
              AND crop_path IS NOT NULL
              AND seen_at >= to_timestamp(%s)
              AND seen_at < to_timestamp(%s)
            ORDER BY quality_score DESC
            LIMIT 1
            """,
            (
                person_id,
                bucket * settings.retention_window_days * 86400,
                (bucket + 1) * settings.retention_window_days * 86400,
            ),
        )
        existing = cur.fetchone()

        if existing is None:
            # No crop for this bucket yet — save this one
            should_save = True
        elif crop_info.quality_score > (existing[2] or 0):
            # New crop is better — replace the old one
            old_path = existing[1]
            if old_path and os.path.exists(old_path):
                os.remove(old_path)
                logger.debug(f"Replaced lower-quality crop: {old_path}")
            should_save = True

        if should_save:
            crop_path = _save_crop(person_id, crop_info.crop, timestamp)

        # Insert sighting row
        bbox_list = crop_info.bbox.tolist()
        embedding_list = embedding.tolist()

        cur.execute(
            """
            INSERT INTO sightings
                (person_id, camera_id, seen_at, quality_score,
                 embedding, crop_path, bbox)
            VALUES (%s, %s, to_timestamp(%s), %s, %s::vector, %s, %s::jsonb)
            """,
            (
                person_id,
                camera_id,
                timestamp,
                crop_info.quality_score,
                str(embedding_list),
                crop_path,
                str(bbox_list),
            ),
        )

    conn.commit()
    logger.info(
        f"Sighting inserted: person={person_id} camera={camera_id} "
        f"crop={'saved' if crop_path else 'skipped'}"
    )


def _save_crop(person_id: int, crop: np.ndarray, timestamp: float) -> str:
    """
    Save a face crop to disk.

    Structure: data/crops/person_{id}/{date}.jpg
    Returns the file path (stored in sightings.crop_path).
    """
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    date_str = dt.strftime("%Y-%m-%d_%H%M%S")

    person_dir = os.path.join(settings.crop_storage_dir, f"person_{person_id}")
    os.makedirs(person_dir, exist_ok=True)

    filename = f"{date_str}.jpg"
    filepath = os.path.join(person_dir, filename)

    # Resize to 112x112 for consistency and storage efficiency
    resized = cv2.resize(crop, (112, 112))
    cv2.imwrite(filepath, resized, [cv2.IMWRITE_JPEG_QUALITY, 85])

    logger.debug(f"Saved crop: {filepath}")
    return filepath