"""
Identity assignment.

Takes a track embedding, searches persons table:
  - Brute-force cosine similarity against all centroids
  - If best match > MATCH_THRESHOLD -> existing person_id
    - Update centroid: normalize((centroid * n + new_emb) / (n+1))
    - Increment embedding_count
  - If no match above threshold -> INSERT new person
    - Centroid = this embedding, embedding_count = 1

Uses SELECT ... FOR UPDATE to prevent race conditions
when multiple camera workers match the same person simultaneously.
"""
