"""
Duplicate sighting suppression.

After identity match resolves a person_id:
  - Was this person seen on this camera within COOLDOWN_HOURS?
  - YES → just update last_seen, no new sighting row
  - NO  → allow insert, return True

Prevents row spam: person at desk for 8 hours doesn't generate
hundreds of sighting rows.
"""
import logging
import psycopg2
from config import settings

logger = logging.getLogger(__name__)


def check(person_id: int, camera_id: str, timestamp: float, conn) -> bool:
    """
    Check if this person was seen recently on this camera.

    Args:
        person_id: matched person
        camera_id: which camera saw them
        timestamp: current sighting time (unix)
        conn: psycopg2 connection (reuse from matcher)

    Returns:
        True = insert a new sighting row
        False = within cooldown, skip insert
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT seen_at FROM sightings
            WHERE person_id = %s AND camera_id = %s
            ORDER BY seen_at DESC
            LIMIT 1
            """,
            (person_id, camera_id),
        )
        row = cur.fetchone()

        if row is None:
            # Never seen on this camera before
            return True

        from datetime import timezone, datetime
        last_seen = row[0]

        # Convert timestamp to datetime for comparison
        current_time = datetime.fromtimestamp(timestamp, tz=timezone.utc)

        # last_seen from DB is already a datetime with timezone
        if last_seen.tzinfo is None:
            from datetime import timezone as tz
            last_seen = last_seen.replace(tzinfo=tz.utc)

        diff_seconds = (current_time - last_seen).total_seconds()

        if diff_seconds < settings.cooldown_seconds:
            logger.debug(
                f"Person {person_id} within cooldown on {camera_id} "
                f"({diff_seconds:.0f}s < {settings.cooldown_seconds}s)"
            )
            # Update last_seen on persons table
            cur.execute(
                "UPDATE persons SET last_seen = to_timestamp(%s) WHERE id = %s",
                (timestamp, person_id),
            )
            conn.commit()
            return False

        return True