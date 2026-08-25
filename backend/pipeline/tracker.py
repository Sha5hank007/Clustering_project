"""
IoU-based multi-face tracker. No neural network, no dependencies beyond numpy.

Core idea:
  - Detector gives us bounding boxes per frame but has no memory.
  - Tracker links boxes across frames: "bbox in frame 1 overlaps 85%
    with bbox in frame 2 → same person, same track_id."
  - One track = one continuous appearance of one face.

Track lifecycle:
  1. CREATED  — unmatched detection starts a new track
  2. ACTIVE   — matched to a detection each frame, bbox updated
  3. DEAD     — MAX_MISSES consecutive detection frames without a match

When a track dies, it emits its best crops (by quality_score).
These crops are the input to the embedder (Person B's code).

On skip frames (no detection runs), tracks predict their position
using velocity. No misses are counted during skip frames.
"""
import numpy as np
from dataclasses import dataclass, field
from pipeline.detector import FaceDetection
from config import settings


@dataclass
class CropInfo:
    """Everything the embedder needs from one crop."""
    crop: np.ndarray        # BGR face crop from original frame
    bbox: np.ndarray        # [x1, y1, x2, y2]
    landmarks: np.ndarray   # (5, 2) keypoints
    quality_score: float
    timestamp: float


@dataclass
class Track:
    """One tracked face across multiple frames."""
    track_id: int
    bbox: np.ndarray              # current [x1, y1, x2, y2]
    velocity: np.ndarray = field(default_factory=lambda: np.zeros(4))
    age: int = 0                  # total frames since creation
    misses: int = 0               # consecutive detection frames without match
    crops: list[CropInfo] = field(default_factory=list)

    def update_bbox(self, new_bbox: np.ndarray) -> None:
        """Update position and velocity from a matched detection."""
        self.velocity = new_bbox - self.bbox
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
        """
        Add a crop to the buffer if it's better than the worst one,
        or if the buffer isn't full yet.
        """
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
            # Replace the worst crop
            worst_idx = min(range(len(self.crops)), key=lambda i: self.crops[i].quality_score)
            self.crops[worst_idx] = crop_info

    @property
    def best_crop(self) -> CropInfo | None:
        """Highest quality crop in the buffer."""
        if not self.crops:
            return None
        return max(self.crops, key=lambda c: c.quality_score)


class Tracker:
    """
    Manages all active tracks. Called by worker.py each frame.

    Two methods:
      update(detections, frame) — on detection frames. Matches detections
        to tracks, creates/kills tracks, returns dead tracks.
      predict() — on skip frames. Shifts bboxes by velocity.
        Returns any tracks that died (from accumulated misses).
    """

    def __init__(self):
        self._next_id = 1
        self.active_tracks: list[Track] = []

    def update(
        self,
        detections: list[tuple[FaceDetection, float]],
        frame: np.ndarray,
    ) -> list[Track]:
        """
        Match detections to active tracks. Called on detection frames.

        Args:
            detections: list of (FaceDetection, quality_score) from quality.py
            frame: original BGR frame (for cropping)

        Returns:
            List of tracks that just died (for embedding by Person B)
        """
        det_bboxes = np.array([d.bbox for d, _ in detections]) if detections else np.empty((0, 4))
        track_bboxes = np.array([t.bbox for t in self.active_tracks]) if self.active_tracks else np.empty((0, 4))

        # Compute IoU matrix: shape (num_tracks, num_detections)
        matched_track_idxs = set()
        matched_det_idxs = set()
        matches = []  # list of (track_idx, det_idx)

        if len(self.active_tracks) > 0 and len(detections) > 0:
            iou_matrix = _compute_iou_matrix(track_bboxes, det_bboxes)

            # Greedy matching: pick highest IoU pairs first
            while True:
                if iou_matrix.size == 0:
                    break

                # Find the highest IoU in the matrix
                max_idx = np.unravel_index(np.argmax(iou_matrix), iou_matrix.shape)
                max_iou = iou_matrix[max_idx]

                if max_iou < settings.iou_threshold:
                    break  # no more good matches

                t_idx, d_idx = int(max_idx[0]), int(max_idx[1])

                if t_idx not in matched_track_idxs and d_idx not in matched_det_idxs:
                    matches.append((t_idx, d_idx))
                    matched_track_idxs.add(t_idx)
                    matched_det_idxs.add(d_idx)

                # Zero out this pair so it's not picked again
                iou_matrix[t_idx, :] = 0
                iou_matrix[:, d_idx] = 0

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

        # Only return dead tracks that have crops (worth embedding)
        return [t for t in dead if len(t.crops) > 0]

    def predict(self) -> list[Track]:
        """
        On skip frames: shift all bboxes by velocity.
        No misses counted. Returns empty list (tracks don't die on skip frames).
        """
        for track in self.active_tracks:
            track.predict_bbox()
        return []


def _compute_iou_matrix(
    bboxes_a: np.ndarray, bboxes_b: np.ndarray
) -> np.ndarray:
    """
    Compute IoU between every pair from two sets of bboxes.

    Args:
        bboxes_a: shape (N, 4) — [x1, y1, x2, y2]
        bboxes_b: shape (M, 4)

    Returns:
        IoU matrix: shape (N, M)
    """
    # Expand dims for broadcasting: (N, 1, 4) vs (1, M, 4)
    a = bboxes_a[:, np.newaxis, :]  # (N, 1, 4)
    b = bboxes_b[np.newaxis, :, :]  # (1, M, 4)

    # Intersection
    inter_x1 = np.maximum(a[..., 0], b[..., 0])
    inter_y1 = np.maximum(a[..., 1], b[..., 1])
    inter_x2 = np.minimum(a[..., 2], b[..., 2])
    inter_y2 = np.minimum(a[..., 3], b[..., 3])

    inter_area = np.maximum(0, inter_x2 - inter_x1) * np.maximum(0, inter_y2 - inter_y1)

    # Union
    area_a = (a[..., 2] - a[..., 0]) * (a[..., 3] - a[..., 1])
    area_b = (b[..., 2] - b[..., 0]) * (b[..., 3] - b[..., 1])
    union_area = area_a + area_b - inter_area + 1e-6

    return inter_area / union_area