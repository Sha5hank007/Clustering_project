"""Save a crop and insert one sighting, scoped to a shop."""
import os
import logging
from datetime import datetime, timezone
from uuid import uuid4
import cv2
import numpy as np
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
    stream_id: str | None = None,
) -> None:
    crop_path = _save_crop(person_id, crop_info.crop, timestamp)

    with conn.cursor() as cur:
        bbox_list = crop_info.bbox.tolist()
        embedding_list = embedding.tolist()

        cur.execute(
            """
            INSERT INTO sightings
                (shop_id, person_id, camera_id, seen_at, quality_score,
                 embedding, crop_path, bbox, job_id, stream_id)
            VALUES (%s, %s, %s, to_timestamp(%s), %s, %s::vector, %s, %s::jsonb, %s, %s)
            """,
            (
                shop_id, person_id, camera_id, timestamp,
                crop_info.quality_score, str(embedding_list),
                crop_path, str(bbox_list), job_id, stream_id,
            ),
        )
        cur.execute(
            "UPDATE persons SET sighting_count = sighting_count + 1 WHERE id = %s",
            (person_id,),
        )

    conn.commit()
    source = "job=%s" % job_id if job_id else "stream=%s" % stream_id if stream_id else "live"
    logger.info(
        "Sighting inserted: person=%d camera=%s shop=%d %s crop=%s"
        % (person_id, camera_id, shop_id, source, "saved")
    )


def _save_crop(person_id, crop, timestamp):
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    date_str = dt.strftime("%Y-%m-%d_%H%M%S_%f")
    person_dir = os.path.join(settings.crop_storage_dir, "person_%d" % person_id)
    os.makedirs(person_dir, exist_ok=True)
    filepath = os.path.join(person_dir, "%s_%s.jpg" % (date_str, uuid4().hex))
    resized = cv2.resize(crop, (112, 112))
    if not cv2.imwrite(filepath, resized, [cv2.IMWRITE_JPEG_QUALITY, 85]):
        raise OSError("Failed to save sighting crop: %s" % filepath)
    return filepath