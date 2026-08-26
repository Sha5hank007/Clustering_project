"""
IoU + center-distance tracker. No neural network, no dependencies beyond numpy.

Two matching strategies (uses the better one):
  1. IoU — works when person is still or moving slowly
  2. Center distance — fallback when person moves fast and bboxes
     don't overlap, but centers are still close

Track lifecycle:
  1. CREATED  — unmatched detection starts a new track
  2. ACTIVE   — matched to a detection each frame, bbox updated
  3. DEAD     — MAX_MISSES consecutive detection frames without a match

When a track dies, it emits its best crops (by quality_score).
"""
import numpy as np
from dataclasses import dataclass, field
from pipeline.detector import FaceDetection
from config import settings


@dataclass
class CropInfo:
    """Everything the embedder needs from one crop."""
    crop: np.ndarray
    bbox: np.ndarray
    landmarks: np.ndarray
    quality_score: float
    timestamp: float


@dataclass
class Track:
    """One tracked face across multiple frames."""
    track_id: int
    bbox: np.ndarray
    velocity: np.ndarray = field(default_factory=lambda: np.zeros(4))
    age: int = 0
    misses: int = 0
    crops: list[CropInfo] = field(default_factory=list)
    _velocity_alpha: float = 0.4  # smoothing factor for velocity EMA

    def update_bbox(self, new_bbox: np.ndarray) -> None:
        """Update position and velocity from a matched detection."""
        # Raw velocity = how much the bbox moved since last known position
        raw_velocity = new_bbox - self.bbox

        # Exponential moving average — prevents one jerky frame from
        # sending the prediction wildly off
        if self.age == 0:
            self.velocity = raw_velocity
        else:
            self.velocity = (
                self._velocity_alpha * raw_velocity
                + (1 - self._velocity_alpha) * self.velocity
            )

        self.bbox = new_bbox.copy()
        self.misses = 0
        self.age += 1

    def predict_bbox(self) -> None:
        """Shift bbox by velocity on skip frames."""
        self.bbox = self.bbox + self.velocity
        self.age += 1

    def maybe_add_crop(
        self, frame: np.ndarray, detection: FaceDetection, quality_score: float
    ) -> None:
        """Add a crop to the buffer if it's better than the worst one."""
        bbox = detection.bbox.astype(int)
        h, w = frame.shape[:2]
        x1 = max(0, bbox[0])
        y1 = max(0, bbox[1])
        x2 = min(w, bbox[2])
        y2 = min(h, bbox[3])

        if x2 <= x1 or y2 <= y1:
            return

        crop_info = CropInfo(
            crop=frame[y1:y2, x1:x2].copy(),
            bbox=detection.bbox.copy(),
            landmarks=detection.landmarks.copy(),
            quality_score=quality_score,
            timestamp=detection.timestamp,
        )

        max_crops = settings.top_crops_per_track

        if len(self.crops) < max_crops:
            self.crops.append(crop_info)
        elif quality_score > min(c.quality_score for c in self.crops):
            worst_idx = min(range(len(self.crops)), key=lambda i: self.crops[i].quality_score)
            self.crops[worst_idx] = crop_info

    @property
    def best_crop(self) -> CropInfo | None:
        if not self.crops:
            return None
        return max(self.crops, key=lambda c: c.quality_score)


class Tracker:
    """
    Manages all active tracks. Called by worker.py each frame.

    Matching uses a combined cost:
      - IoU (intersection over union of bboxes)
      - Center distance relative to face size
    A match is valid if IoU > threshold OR center distance < max_center_dist.
    This handles the case where a person moves quickly — bboxes don't overlap
    but centers are still close.
    """

    # Max center distance as a multiple of face diagonal.
    # 1.5 means the center can move up to 1.5x the face diagonal
    # between detection frames and still match.
    MAX_CENTER_DIST_RATIO = 0.8

    def __init__(self):
        self._next_id = 1
        self.active_tracks: list[Track] = []

    def update(
        self,
        detections: list[tuple[FaceDetection, float]],
        frame: np.ndarray,
    ) -> list[Track]:
        """Match detections to active tracks on detection frames."""

        matched_track_idxs = set()
        matched_det_idxs = set()
        matches = []

        if len(self.active_tracks) > 0 and len(detections) > 0:
            track_bboxes = np.array([t.bbox for t in self.active_tracks])
            det_bboxes = np.array([d.bbox for d, _ in detections])

            # Compute both cost matrices
            iou_matrix = _compute_iou_matrix(track_bboxes, det_bboxes)
            center_dist_matrix = _compute_center_dist_matrix(track_bboxes, det_bboxes)

            # Combined validity: match if IoU is good OR center distance is small
            # For greedy matching, use a combined score (higher = better match)
            # Normalize center distance to 0-1 range (1 = close, 0 = far)
            max_dist = self.MAX_CENTER_DIST_RATIO
            center_score = np.clip(1.0 - center_dist_matrix / max_dist, 0, 1)

            # Take the better of the two scores
            match_score = np.maximum(iou_matrix, center_score)

            # Greedy matching on combined score
            while True:
                if match_score.size == 0:
                    break

                max_flat = np.argmax(match_score)
                t_idx, d_idx = divmod(int(max_flat), match_score.shape[1])
                best_score = match_score[t_idx, d_idx]

                # Minimum threshold: at least some IoU or close centers
                if best_score < 0.15:
                    break

                if t_idx not in matched_track_idxs and d_idx not in matched_det_idxs:
                    matches.append((t_idx, d_idx))
                    matched_track_idxs.add(t_idx)
                    matched_det_idxs.add(d_idx)

                match_score[t_idx, :] = 0
                match_score[:, d_idx] = 0

        # ── Apply matches ──
        for t_idx, d_idx in matches:
            track = self.active_tracks[t_idx]
            det, quality = detections[d_idx]
            track.update_bbox(det.bbox)
            track.maybe_add_crop(frame, det, quality)

        # ── Increment misses for unmatched tracks ──
        for t_idx in range(len(self.active_tracks)):
            if t_idx not in matched_track_idxs:
                self.active_tracks[t_idx].misses += 1
                self.active_tracks[t_idx].age += 1
                # Stop predicting — velocity is meaningless without matches
                self.active_tracks[t_idx].velocity = np.zeros(4)

        # ── Create new tracks for unmatched detections ──
        for d_idx in range(len(detections)):
            if d_idx not in matched_det_idxs:
                det, quality = detections[d_idx]
                track = Track(
                    track_id=self._next_id,
                    bbox=det.bbox.copy(),
                )
                track.maybe_add_crop(frame, det, quality)
                self.active_tracks.append(track)
                self._next_id += 1

        # ── Kill dead tracks ──
        dead = [t for t in self.active_tracks if t.misses >= settings.max_misses]
        self.active_tracks = [t for t in self.active_tracks if t.misses < settings.max_misses]

        return [t for t in dead if len(t.crops) > 0]

    def predict(self) -> list[Track]:
        """On skip frames: shift bboxes by velocity for healthy tracks only."""
        for track in self.active_tracks:
            if track.misses == 0:
                track.predict_bbox()
        return []


def _compute_iou_matrix(
    bboxes_a: np.ndarray, bboxes_b: np.ndarray
) -> np.ndarray:
    """IoU between every pair. Shape (N, M)."""
    a = bboxes_a[:, np.newaxis, :]
    b = bboxes_b[np.newaxis, :, :]

    inter_x1 = np.maximum(a[..., 0], b[..., 0])
    inter_y1 = np.maximum(a[..., 1], b[..., 1])
    inter_x2 = np.minimum(a[..., 2], b[..., 2])
    inter_y2 = np.minimum(a[..., 3], b[..., 3])

    inter_area = np.maximum(0, inter_x2 - inter_x1) * np.maximum(0, inter_y2 - inter_y1)

    area_a = (a[..., 2] - a[..., 0]) * (a[..., 3] - a[..., 1])
    area_b = (b[..., 2] - b[..., 0]) * (b[..., 3] - b[..., 1])
    union_area = area_a + area_b - inter_area + 1e-6

    return inter_area / union_area


def _compute_center_dist_matrix(
    bboxes_a: np.ndarray, bboxes_b: np.ndarray
) -> np.ndarray:
    """
    Center distance between every pair, normalized by face diagonal.
    Returns shape (N, M). Values close to 0 = centers are close.

    Normalization by face diagonal makes this scale-invariant:
    a 200px face moving 50px is the same "distance" as a 100px face moving 25px.
    """
    # Centers of A
    cx_a = (bboxes_a[:, 0] + bboxes_a[:, 2]) / 2  # (N,)
    cy_a = (bboxes_a[:, 1] + bboxes_a[:, 3]) / 2
    # Diagonals of A (for normalization)
    w_a = bboxes_a[:, 2] - bboxes_a[:, 0]
    h_a = bboxes_a[:, 3] - bboxes_a[:, 1]
    diag_a = np.sqrt(w_a**2 + h_a**2) + 1e-6  # (N,)

    # Centers of B
    cx_b = (bboxes_b[:, 0] + bboxes_b[:, 2]) / 2  # (M,)
    cy_b = (bboxes_b[:, 1] + bboxes_b[:, 3]) / 2

    # Euclidean distance between every pair of centers
    dx = cx_a[:, np.newaxis] - cx_b[np.newaxis, :]  # (N, M)
    dy = cy_a[:, np.newaxis] - cy_b[np.newaxis, :]
    dist = np.sqrt(dx**2 + dy**2)

    # Normalize by face diagonal of track (A)
    normalized = dist / diag_a[:, np.newaxis]

    return normalized