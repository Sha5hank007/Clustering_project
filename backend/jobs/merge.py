"""
Nightly identity merge job.

Problem: same person with glasses on/off, different lighting,
can drift past MATCH_THRESHOLD and spawn duplicate person IDs.

Solution: for each pair of person centroids with cosine > MERGE_THRESHOLD (0.65):
  - Merge into the older person_id
  - UPDATE sightings SET person_id = older WHERE person_id = newer
  - Recompute centroid from constituent embeddings
  - DELETE the newer person row

Cap merges per run. Log every merge for audit.
"""
