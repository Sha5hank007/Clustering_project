"""
Identity assignment, scoped to a shop.

Takes a track embedding (512-d), searches persons within the SAME SHOP:
  - Cosine similarity against centroids WHERE shop_id = X
  - Match above threshold → existing person, update centroid
  - No match → create new person with shop_id
"""
import logging
import numpy as np
import psycopg2
from config import settings

logger = logging.getLogger(__name__)

_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")


def get_connection():
    return psycopg2.connect(_db_url)


def match_or_create(
    embedding: np.ndarray,
    timestamp: float,
    shop_id: int,
) -> int:
    """
    Match an embedding against person centroids within this shop.
    Returns person_id (existing or newly created).
    """
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                # Only search centroids within this shop
                cur.execute(
                    "SELECT id, centroid FROM persons WHERE shop_id = %s",
                    (shop_id,),
                )
                rows = cur.fetchall()

                if rows:
                    person_ids = []
                    centroids = []
                    for row in rows:
                        person_ids.append(row[0])
                        centroid_str = row[1]
                        if isinstance(centroid_str, str):
                            centroid = np.fromstring(centroid_str.strip("[]"), sep=",")
                        else:
                            centroid = np.array(centroid_str)
                        centroids.append(centroid)

                    centroids = np.array(centroids)
                    similarities = centroids @ embedding
                    best_idx = int(np.argmax(similarities))
                    best_sim = float(similarities[best_idx])

                    if best_sim >= settings.match_threshold:
                        person_id = person_ids[best_idx]
                        _update_person(cur, person_id, embedding, timestamp)
                        logger.info(
                            "Matched to person %d (similarity=%.3f, shop=%d)"
                            % (person_id, best_sim, shop_id)
                        )
                        return person_id

                # No match — create new person in this shop
                person_id = _create_person(cur, embedding, timestamp, shop_id)
                logger.info("Created new person %d (shop=%d)" % (person_id, shop_id))
                return person_id
    finally:
        conn.close()


def _update_person(cur, person_id, embedding, timestamp):
    cur.execute(
        "SELECT centroid, embedding_count FROM persons WHERE id = %s FOR UPDATE",
        (person_id,),
    )
    row = cur.fetchone()
    old_centroid_str = row[0]
    n = row[1]

    if isinstance(old_centroid_str, str):
        old_centroid = np.fromstring(old_centroid_str.strip("[]"), sep=",")
    else:
        old_centroid = np.array(old_centroid_str)

    new_centroid = (old_centroid * n + embedding) / (n + 1)
    norm = np.linalg.norm(new_centroid)
    if norm > 1e-10:
        new_centroid = new_centroid / norm

    cur.execute(
        """
        UPDATE persons
        SET centroid = %s::vector,
            embedding_count = embedding_count + 1,
            sighting_count = sighting_count + 1,
            last_seen = to_timestamp(%s)
        WHERE id = %s
        """,
        (str(new_centroid.tolist()), timestamp, person_id),
    )


def _create_person(cur, embedding, timestamp, shop_id):
    cur.execute(
        """
        INSERT INTO persons (shop_id, centroid, embedding_count, sighting_count,
                             first_seen, last_seen, model_version)
        VALUES (%s, %s::vector, 1, 1, to_timestamp(%s), to_timestamp(%s), %s)
        RETURNING id
        """,
        (shop_id, str(embedding.tolist()), timestamp, timestamp, settings.recognizer_model),
    )
    return cur.fetchone()[0]