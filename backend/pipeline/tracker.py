"""
IoU-based multi-face tracker. No neural network.

Track lifecycle:
  1. CREATED  -- unmatched detection starts a new track
  2. ACTIVE   -- matched to a detection each frame, bbox updated
  3. DEAD     -- MAX_MISSES consecutive frames without a match

On each detection frame:
  - Compute IoU between all active track bboxes and all new detections
  - Hungarian algorithm finds optimal assignment
  - Matched: update track bbox, velocity, maybe swap in better crop
  - Unmatched detection: create new track
  - Unmatched track: increment miss counter

On skip frames (no detection):
  - Predict each track's bbox using velocity: bbox += velocity

On track death:
  - Emit the track's best N crops (by quality_score)
  - These crops are the input to embedder.py

This is the core optimization: 3000 frames of one person
= 1 track = 1 embedding call, not 3000.
"""
