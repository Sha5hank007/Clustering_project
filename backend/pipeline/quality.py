"""
Quality gate — filters and scores detections before they enter the tracker.

All pure functions, no state, no model. Runs on the CPU crop, not on the
full frame, so it's cheap.

Three checks:
1. Face width in pixels — too small = not enough detail to recognize
2. Laplacian blur — out-of-focus or motion-blurred faces produce garbage embeddings
3. Landmark symmetry — proxy for yaw angle; side-profile faces embed poorly

Each check can reject a detection outright. Survivors get a composite
quality_score used by the tracker's crop buffer (keep best N) and by
the retention policy (keep best crop per bucket).
"""
import numpy as np
import cv2
from pipeline.detector import FaceDetection
from config import settings


def compute_quality(detection: FaceDetection, frame: np.ndarray) -> float | None:
    """
    Compute quality score for a detection. Returns None if the face
    should be rejected entirely.

    Args:
        detection: FaceDetection from detector
        frame: original BGR frame (needed to extract the crop for blur check)

    Returns:
        quality_score (0.0 - 1.0) or None if rejected
    """
    bbox = detection.bbox.astype(int)
    x1, y1, x2, y2 = bbox

    # ── Check 1: minimum face size ──
    face_width = x2 - x1
    if face_width < settings.min_face_px:
        return None

    # Clamp bbox to frame bounds
    h, w = frame.shape[:2]
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w, x2)
    y2 = min(h, y2)

    if x2 <= x1 or y2 <= y1:
        return None

    crop = frame[y1:y2, x1:x2]

    # ── Check 2: blur detection ──
    blur_score = _laplacian_variance(crop)
    if blur_score < settings.blur_threshold:
        return None

    # ── Check 3: pose estimation from landmarks ──
    yaw = _estimate_yaw(detection.landmarks)
    if abs(yaw) > settings.max_yaw_degrees:
        return None

    # ── Composite quality score ──
    # Normalize each component to 0-1 range, then weighted average
    #   det_score: already 0-1
    #   blur: higher is better, cap at 500 for normalization
    #   yaw: 0 is best (frontal), 30 is worst (threshold)
    det_component = detection.score
    blur_component = min(blur_score / 500.0, 1.0)
    yaw_component = 1.0 - (abs(yaw) / settings.max_yaw_degrees)

    quality = (
        0.3 * det_component
        + 0.4 * blur_component
        + 0.3 * yaw_component
    )

    return float(quality)


def filter_detections(
    detections: list[FaceDetection], frame: np.ndarray
) -> list[tuple[FaceDetection, float]]:
    """
    Filter a list of detections, returning only those that pass
    all quality checks, paired with their quality scores.
    """
    results = []
    for det in detections:
        score = compute_quality(det, frame)
        if score is not None:
            results.append((det, score))
    return results


def _laplacian_variance(crop: np.ndarray) -> float:
    """
    Blur detection via Laplacian variance.

    The Laplacian operator highlights edges. A sharp image has strong edges
    = high variance. A blurry image has weak edges = low variance.

    Typical values:
      < 30:  very blurry (motion blur, out of focus)
      30-80: somewhat blurry
      > 80:  sharp enough for recognition
      > 200: very sharp

    settings.blur_threshold defaults to 50.0
    """
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    return float(laplacian.var())


def _estimate_yaw(landmarks: np.ndarray) -> float:
    """
    Estimate face yaw (left-right rotation) from the 5 landmarks.

    Landmarks: [left_eye, right_eye, nose, left_mouth, right_mouth]

    Method: compare the nose-to-left-eye distance vs nose-to-right-eye distance.
    If the face is frontal, these are roughly equal. If turned right,
    the left eye is farther from the nose than the right eye.

    Returns approximate yaw in degrees. Positive = turned right.
    This is a rough estimate, not precise — we just need to reject
    extreme side profiles, not measure exact angles.
    """
    left_eye = landmarks[0]   # (x, y)
    right_eye = landmarks[1]
    nose = landmarks[2]

    # Distance from nose to each eye
    dist_left = np.linalg.norm(nose - left_eye)
    dist_right = np.linalg.norm(nose - right_eye)

    # Avoid division by zero
    if dist_left + dist_right < 1e-6:
        return 0.0

    # Ratio: 0.5 = perfectly symmetric (frontal), 0 or 1 = full profile
    ratio = dist_right / (dist_left + dist_right)

    # Map ratio to approximate degrees
    # 0.5 -> 0°, 0.3 -> ~30°, 0.7 -> ~-30°
    yaw_degrees = (0.5 - ratio) * 120.0  # rough linear mapping

    return float(yaw_degrees)