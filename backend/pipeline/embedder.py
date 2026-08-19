"""
Alignment + ArcFace embedding.

Takes a dead track's best crops (with landmarks):
  1. Align each crop: similarity transform using 5 landmarks -> 112x112
  2. Run ArcFace forward pass -> 512-d vector per crop
  3. Average all vectors, L2-normalize -> single track embedding

Uses the same InsightFace model instance loaded by detector.py.
The recognizer (w600k_mbf or w600k_r50) is already in memory.

Output: one 512-d unit vector representing this person's visit.
"""
