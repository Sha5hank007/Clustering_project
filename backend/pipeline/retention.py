"""
Image retention policy.

Controls which sightings get a saved face crop on disk.
Rule: one best crop per person per RETENTION_WINDOW_DAYS.

On new sighting:
  - Compute date bucket: floor(seen_at / retention_window)
  - If no crop for (person_id, bucket): save this crop
  - If existing crop but new quality_score is higher: replace
  - Else: insert sighting row with crop_path = NULL

Storage math: 112x112 JPEG ~ 5KB.
200 people x 1 crop/2 days x 365 days ~ 180 MB/year.
"""
