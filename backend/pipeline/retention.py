"""
Image retention policy + sighting insertion, scoped to a shop.
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
    shop_id: int,
    job_id: str | None = None,
) -> None:
    """
    Insert a sighting row and optionally save a face crop to disk.
    """
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    bucket = dt.toordinal() // settings.retention_window_days

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
            should_save = True
        elif crop_info.quality_score > (existing[2] or 0):
            old_path = existing[1]
            if old_path and os.path.exists(old_path):
                os.remove(old_path)
            should_save = True

        if should_save:
            crop_path = _save_crop(person_id, crop_info.crop, timestamp)

        bbox_list = crop_info.bbox.tolist()
        embedding_list = embedding.tolist()

        cur.execute(
            """
            INSERT INTO sightings
                (shop_id, person_id, camera_id, seen_at, quality_score,
                 embedding, crop_path, bbox, job_id)
            VALUES (%s, %s, %s, to_timestamp(%s), %s, %s::vector, %s, %s::jsonb, %s)
            """,
            (
                shop_id,
                person_id,
                camera_id,
                timestamp,
                crop_info.quality_score,
                str(embedding_list),
                crop_path,
                str(bbox_list),
                job_id,
            ),
        )

    conn.commit()
    logger.info(
        "Sighting inserted: person=%d camera=%s shop=%d crop=%s"
        % (person_id, camera_id, shop_id, "saved" if crop_path else "skipped")
    )


def _save_crop(person_id, crop, timestamp):
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    date_str = dt.strftime("%Y-%m-%d_%H%M%S")

    person_dir = os.path.join(settings.crop_storage_dir, "person_%d" % person_id)
    os.makedirs(person_dir, exist_ok=True)

    filename = "%s.jpg" % date_str
    filepath = os.path.join(person_dir, filename)

    resized = cv2.resize(crop, (112, 112))
    cv2.imwrite(filepath, resized, [cv2.IMWRITE_JPEG_QUALITY, 85])

    return filepath