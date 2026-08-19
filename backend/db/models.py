"""
SQLAlchemy ORM models.

persons
  - id: int PK
  - centroid: Vector(512)           -- running mean of all embeddings
  - embedding_count: int            -- how many embeddings folded into centroid
  - sighting_count: int             -- total visits recorded
  - first_seen: datetime(tz)
  - last_seen: datetime(tz)
  - label: str nullable             -- owner-assigned name
  - model_version: str              -- embedding model used

sightings
  - id: int PK
  - person_id: FK -> persons.id
  - camera_id: str                  -- logical camera name from .env
  - seen_at: datetime(tz)
  - quality_score: float
  - embedding: Vector(512)
  - crop_path: str nullable         -- null if no crop retained for this sighting
  - bbox: JSONB                     -- [x1, y1, x2, y2]
"""
