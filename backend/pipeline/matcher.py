"""
Identity assignment.

Takes a track embedding (512-d), searches the persons table:
  - Brute-force cosine similarity against all centroids
  - If best match > MATCH_THRESHOLD → existing person_id, update centroid
  - If no match → INSERT new person

Uses synchronous psycopg2 (not async) because the worker loop is synchronous.
The API (phase 2) uses async SQLAlchemy, but the worker is a simple loop.
"""
import logging
import numpy as np
import psycopg2
import psycopg2.extras
from config import settings

logger = logging.getLogger(__name__)

# Parse DATABASE_URL for psycopg2 (it uses a different format than asyncpg)
# DATABASE_URL = postgresql+asyncpg://user:pass@host:port/db
# psycopg2 wants: postgresql://user:pass@host:port/db
_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")


def get_connection():
    return psycopg2.connect(_db_url)


def match_or_create(
    embedding: np.ndarray,
    timestamp: float,
) -> int:
    """
    Match an embedding against all person centroids.
    Returns person_id (existing or newly created).

    Args:
        embedding: 512-d unit vector
        timestamp: Unix timestamp of the sighting

    Returns:
        person_id: int
    """
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                # Fetch all centroids
                cur.execute("SELECT id, centroid FROM persons")
                rows = cur.fetchall()

                if rows:
                    person_ids = []
                    centroids = []
                    for row in rows:
                        person_ids.append(row[0])
                        # pgvector returns a string like '[0.1,0.2,...]'
                        centroid_str = row[1]
                        if isinstance(centroid_str, str):
                            centroid = np.fromstring(
                                centroid_str.strip("[]"), sep=","
                            )
                        else:
                            centroid = np.array(centroid_str)
                        centroids.append(centroid)

                    centroids = np.array(centroids)

                    # Cosine similarity = dot product (both are unit vectors)
                    similarities = centroids @ embedding
                    best_idx = int(np.argmax(similarities))
                    best_sim = float(similarities[best_idx])

                    if best_sim >= settings.match_threshold:
                        person_id = person_ids[best_idx]
                        _update_person(cur, person_id, embedding, timestamp)
                        logger.info(
                            f"Matched to person {person_id} "
                            f"(similarity={best_sim:.3f})"
                        )
                        return person_id

                # No match — create new person
                person_id = _create_person(cur, embedding, timestamp)
                logger.info(f"Created new person {person_id}")
                return person_id
    finally:
        conn.close()


def _update_person(
    cur, person_id: int, embedding: np.ndarray, timestamp: float
) -> None:
    """
    Update existing person's centroid (running mean) and timestamps.

    centroid = normalize((old_centroid * n + new_embedding) / (n + 1))
    """
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

    # Running mean
    new_centroid = (old_centroid * n + embedding) / (n + 1)
    norm = np.linalg.norm(new_centroid)
    if norm > 1e-10:
        new_centroid = new_centroid / norm

    centroid_list = new_centroid.tolist()

    cur.execute(
        """
        UPDATE persons
        SET centroid = %s::vector,
            embedding_count = embedding_count + 1,
            sighting_count = sighting_count + 1,
            last_seen = to_timestamp(%s)
        WHERE id = %s
        """,
        (str(centroid_list), timestamp, person_id),
    )


def _create_person(
    cur, embedding: np.ndarray, timestamp: float
) -> int:
    """Insert a new person with this embedding as their centroid."""
    centroid_list = embedding.tolist()

    cur.execute(
        """
        INSERT INTO persons (centroid, embedding_count, sighting_count,
                             first_seen, last_seen, model_version)
        VALUES (%s::vector, 1, 1, to_timestamp(%s), to_timestamp(%s), %s)
        RETURNING id
        """,
        (str(centroid_list), timestamp, timestamp, settings.recognizer_model),
    )
    return cur.fetchone()[0]