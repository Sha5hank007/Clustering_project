"""
Quality gate -- filters detections before they enter the tracker.
Pure functions, no state, no model.

Checks per detection:
  - Face width in pixels >= MIN_FACE_PX
  - Laplacian variance (blur) >= BLUR_THRESHOLD
  - Landmark-based pose estimate <= MAX_YAW_DEGREES
  - Computes composite quality_score (weighted combination)

Rejects low-quality faces BEFORE tracking to avoid
wasting track slots on garbage detections.
"""
