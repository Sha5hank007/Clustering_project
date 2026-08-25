"""
SCRFD face detector using ONNX Runtime directly.

We're not using the insightface Python package (it won't compile on Windows
without C++ Build Tools). Instead we load the same ONNX model files and
handle preprocessing/postprocessing ourselves.

Model: det_10g.onnx from InsightFace's buffalo_l pack
Input: RGB image normalized to (pixel - 127.5) / 128.0, shape [1, 3, H, W]
Output: 9 tensors — scores, bboxes, keypoints for 3 stride levels (8, 16, 32)

The output ordering is:
  outputs[0..2] = scores  for strides 8, 16, 32
  outputs[3..5] = bboxes  for strides 8, 16, 32
  outputs[6..8] = keypoints for strides 8, 16, 32
"""
import os
import numpy as np
import onnxruntime as ort
import cv2
from dataclasses import dataclass
from config import settings


@dataclass
class FaceDetection:
    """One detected face in a single frame."""
    bbox: np.ndarray        # [x1, y1, x2, y2] in original image coordinates
    score: float            # detection confidence 0.0 - 1.0
    landmarks: np.ndarray   # shape (5, 2): left_eye, right_eye, nose, left_mouth, right_mouth
    timestamp: float        # when this frame was captured


class Detector:
    """
    Loads SCRFD ONNX model once at startup.
    Call detect(frame, timestamp) to get a list of FaceDetection objects.
    """
    STRIDES = [8, 16, 32]
    NUM_ANCHORS = 2  # SCRFD uses 2 anchors per location

    def __init__(self):
        model_path = os.path.join(settings.model_dir, settings.detector_model)
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Detector model not found at {model_path}. "
                f"Download buffalo_l models and place them in {settings.model_dir}/"
            )

        # Configure ONNX Runtime for CPU
        sess_opts = ort.SessionOptions()
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # Use all physical cores
        sess_opts.intra_op_num_threads = os.cpu_count()
        sess_opts.log_severity_level = 3  # only show errors, not warnings

        self.session = ort.InferenceSession(
            model_path,
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]

        self.det_size = settings.det_size_tuple  # (width, height)

        # Determine if model outputs keypoints
        # 9 outputs = scores(3) + bboxes(3) + keypoints(3)
        # 6 outputs = scores(3) + bboxes(3), no keypoints
        self.fmc = len(self.STRIDES)  # feature map count = 3
        self.has_landmarks = len(self.output_names) >= 9

    def detect(self, frame: np.ndarray, timestamp: float) -> list[FaceDetection]:
        """
        Detect faces in a BGR frame.

        Steps:
        1. Resize frame to det_size, preserving aspect ratio, pad with zeros
        2. Normalize pixel values: (pixel - 127.5) / 128.0
        3. Run SCRFD inference
        4. Decode outputs into bboxes + landmarks in original image coordinates
        5. Apply NMS to remove overlapping detections
        6. Filter by det_threshold
        """
        # Optional: crop to ROI before detection
        roi = settings.roi_tuple
        roi_offset_x, roi_offset_y = 0, 0
        if roi is not None:
            x1, y1, x2, y2 = roi
            frame = frame[y1:y2, x1:x2]
            roi_offset_x, roi_offset_y = x1, y1

        # Preprocess
        blob, scale = self._preprocess(frame)

        # Inference
        outputs = self.session.run(self.output_names, {self.input_name: blob})

        # Decode
        bboxes, scores, landmarks = self._decode(outputs, scale)

        if len(scores) == 0:
            return []

        # NMS
        keep = self._nms(bboxes, scores, threshold=0.4)

        # Build results
        detections = []
        for i in keep:
            if scores[i] < settings.det_threshold:
                continue

            bbox = bboxes[i].copy()
            lms = landmarks[i].copy()

            # Shift back if ROI was applied
            if roi is not None:
                bbox[[0, 2]] += roi_offset_x
                bbox[[1, 3]] += roi_offset_y
                lms[:, 0] += roi_offset_x
                lms[:, 1] += roi_offset_y

            detections.append(FaceDetection(
                bbox=bbox,
                score=float(scores[i]),
                landmarks=lms,
                timestamp=timestamp,
            ))

        return detections

    def _preprocess(self, frame: np.ndarray) -> tuple[np.ndarray, float]:
        """
        Resize to det_size preserving aspect ratio, pad top-left aligned.
        Normalize and convert to NCHW RGB float32.

        Returns (blob, scale) where scale maps det_size coords back to original.
        """
        img_h, img_w = frame.shape[:2]
        det_w, det_h = self.det_size

        # Scale to fit within det_size while preserving aspect ratio
        scale = min(det_w / img_w, det_h / img_h)
        new_w = int(img_w * scale)
        new_h = int(img_h * scale)

        resized = cv2.resize(frame, (new_w, new_h))

        # Pad with zeros, top-left aligned
        det_img = np.zeros((det_h, det_w, 3), dtype=np.uint8)
        det_img[:new_h, :new_w, :] = resized

        # Normalize: (pixel - 127.5) / 128.0, BGR -> RGB, HWC -> NCHW
        blob = (det_img.astype(np.float32) - 127.5) / 128.0
        blob = blob[:, :, ::-1]  # BGR -> RGB
        blob = blob.transpose(2, 0, 1)[np.newaxis, ...]  # (1, 3, H, W)

        return blob, scale

    def _decode(
        self, outputs: list[np.ndarray], scale: float
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Decode raw SCRFD outputs into bboxes, scores, landmarks
        in original image coordinates.

        Output layout (9 outputs):
          outputs[0..2]  = scores    for strides 8, 16, 32
          outputs[3..5]  = bboxes    for strides 8, 16, 32
          outputs[6..8]  = keypoints for strides 8, 16, 32
        """
        all_bboxes = []
        all_scores = []
        all_landmarks = []

        det_w, det_h = self.det_size

        for idx, stride in enumerate(self.STRIDES):
            # Extract outputs for this stride level
            scores_raw = outputs[idx].reshape(-1)
            bbox_raw = outputs[idx + self.fmc].reshape(-1, 4)

            # Generate anchor grid
            feat_h = det_h // stride
            feat_w = det_w // stride

            # Anchor centers: grid of (x, y) positions
            anchor_y, anchor_x = np.mgrid[:feat_h, :feat_w]
            anchors = np.stack([anchor_x, anchor_y], axis=-1).astype(np.float32)
            anchors = (anchors * stride).reshape(-1, 2)

            # SCRFD uses 2 anchors per grid position
            if self.NUM_ANCHORS > 1:
                anchors = np.stack([anchors] * self.NUM_ANCHORS, axis=1).reshape(-1, 2)

            # Decode bboxes: distance format [left, top, right, bottom] * stride
            bbox_deltas = bbox_raw * stride
            x1 = anchors[:, 0] - bbox_deltas[:, 0]
            y1 = anchors[:, 1] - bbox_deltas[:, 1]
            x2 = anchors[:, 0] + bbox_deltas[:, 2]
            y2 = anchors[:, 1] + bbox_deltas[:, 3]
            bboxes = np.stack([x1, y1, x2, y2], axis=-1)

            # Scale back to original image coordinates
            bboxes /= scale

            all_bboxes.append(bboxes)
            all_scores.append(scores_raw)

            # Decode keypoints if available
            if self.has_landmarks:
                kps_raw = outputs[idx + self.fmc * 2].reshape(-1, 10)
                kps_deltas = kps_raw * stride
                lms = np.zeros((kps_deltas.shape[0], 5, 2), dtype=np.float32)
                for k in range(5):
                    lms[:, k, 0] = (anchors[:, 0] + kps_deltas[:, 2 * k]) / scale
                    lms[:, k, 1] = (anchors[:, 1] + kps_deltas[:, 2 * k + 1]) / scale
                all_landmarks.append(lms)

        bboxes = np.concatenate(all_bboxes, axis=0)
        scores = np.concatenate(all_scores, axis=0)

        if self.has_landmarks:
            landmarks = np.concatenate(all_landmarks, axis=0)
        else:
            landmarks = np.zeros((len(scores), 5, 2), dtype=np.float32)

        return bboxes, scores, landmarks

    def _nms(
        self, bboxes: np.ndarray, scores: np.ndarray, threshold: float = 0.4
    ) -> list[int]:
        """
        Non-maximum suppression.
        Removes overlapping detections, keeping the highest-scoring one.
        """
        x1, y1, x2, y2 = bboxes[:, 0], bboxes[:, 1], bboxes[:, 2], bboxes[:, 3]
        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(int(i))

            if order.size == 1:
                break

            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
            iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)

            remaining = np.where(iou <= threshold)[0]
            order = order[remaining + 1]

        return keep