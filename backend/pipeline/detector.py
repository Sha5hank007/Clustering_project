"""
Wraps InsightFace FaceAnalysis.
- Loads model pack (buffalo_s or buffalo_l) ONCE at startup
- Takes a frame, returns list of raw detections (bbox, landmarks, det_score)
- Handles det_size resize and optional ROI crop
- Filters by DET_THRESHOLD

The model pack lives at ~/.insightface/models/{MODEL_PACK}/
and contains:
  det_*.onnx     -- SCRFD face detector
  w600k_*.onnx   -- ArcFace face recognizer
Both are loaded by FaceAnalysis but only detection runs here.
Embedding runs in embedder.py using the same loaded model.
"""
