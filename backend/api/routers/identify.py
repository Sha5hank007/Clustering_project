"""
POST /identify -- Owner uploads an image.

Flow:
  1. Receive image (multipart upload)
  2. Detect face (reject if 0 or >1)
  3. Align + embed
  4. Cosine match against persons.centroid
  5. If match > QUERY_THRESHOLD: return person history + crops
  6. Else: 404 no match found

Response:
  {
    person_id, label, similarity,
    first_seen, last_seen, total_sightings,
    sightings: [{seen_at, camera_id, crop_url}, ...]
  }
"""
