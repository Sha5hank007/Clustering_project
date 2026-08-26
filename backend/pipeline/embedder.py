"""
Face alignment + ArcFace embedding using ONNX Runtime directly.

Takes a dead track's best crops (with landmarks) and produces a single
512-d embedding vector representing this person's visit.

Steps per crop:
  1. Align: similarity transform from 5 detected landmarks to canonical
     positions → 112×112 face crop with eyes level, nose centered
  2. Normalize pixels: (pixel - 127.5) / 127.5, BGR → RGB
  3. ArcFace forward pass → 512-d vector

Then average all crop vectors, L2-normalize → one embedding per track.

Model: w600k_r50.onnx from InsightFace's buffalo_l pack
  - Input: [1, 3, 112, 112] RGB float32
  - Output: [1, 512] raw embedding
"""
import os
import numpy as np
import onnxruntime as ort
import cv2
from pipeline.tracker import CropInfo
from config import settings

# Canonical landmark positions for a 112×112 aligned face.
# These are where the 5 keypoints should end up after alignment:
#   left eye, right eye, nose tip, left mouth corner, right mouth corner
# ArcFace was trained on faces aligned to these exact positions.
ARCFACE_REF = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
], dtype=np.float32)


class Embedder:
    """
    Loads ArcFace ONNX model once at startup.
    Call embed(crops) to get a single 512-d vector for a set of crops.
    """

    def __init__(self):
        model_path = os.path.join(settings.model_dir, settings.recognizer_model)
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Recognizer model not found at {model_path}. "
                f"Download buffalo_l models and place them in {settings.model_dir}/"
            )

        sess_opts = ort.SessionOptions()
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_opts.intra_op_num_threads = os.cpu_count()
        sess_opts.log_severity_level = 3

        self.session = ort.InferenceSession(
            model_path,
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]

    def embed(self, crops: list[CropInfo]) -> np.ndarray:
        """
        Produce one 512-d embedding from a set of crops.

        Steps:
          1. Align each crop using its landmarks
          2. Run ArcFace on each aligned face
          3. Average all embeddings
          4. L2-normalize the average

        Returns:
          np.ndarray of shape (512,), unit length
        """
        embeddings = []

        for crop_info in crops:
            aligned = self._align(crop_info.crop, crop_info.landmarks, crop_info.bbox)
            if aligned is None:
                continue

            emb = self._forward(aligned)
            embeddings.append(emb)

        if not embeddings:
            raise ValueError("No valid crops to embed")

        # Average and normalize
        avg = np.mean(embeddings, axis=0)
        norm = np.linalg.norm(avg)
        if norm < 1e-10:
            raise ValueError("Zero-norm embedding")
        return avg / norm

    def embed_single(self, crop: np.ndarray, landmarks: np.ndarray, bbox: np.ndarray) -> np.ndarray:
        """
        Embed a single face crop. Used by the query endpoint (pipeline 2).
        Returns np.ndarray of shape (512,), unit length.
        """
        aligned = self._align(crop, landmarks, bbox)
        if aligned is None:
            raise ValueError("Alignment failed")
        emb = self._forward(aligned)
        norm = np.linalg.norm(emb)
        if norm < 1e-10:
            raise ValueError("Zero-norm embedding")
        return emb / norm

    def _align(
        self, crop: np.ndarray, landmarks: np.ndarray, bbox: np.ndarray
    ) -> np.ndarray | None:
        """
        Align a face crop to 112×112 using a similarity transform.

        The landmarks from the detector are in ORIGINAL FRAME coordinates.
        The crop is a sub-image cut from the frame using bbox.
        So we need to shift landmarks to be relative to the crop,
        OR apply the transform directly on the original frame.

        We apply directly on the original frame since we stored the
        full crop which may have different bounds than bbox.
        For simplicity, we work with the crop and offset landmarks.
        """
        # Landmarks are in original frame coordinates.
        # Shift to crop-local coordinates
        src_landmarks = landmarks.copy().astype(np.float32)

        # estimateAffinePartial2D computes the best similarity transform
        # (rotation + uniform scale + translation) from src → dst points.
        # This is a 2×3 matrix M such that dst ≈ M @ [src; 1]
        M, _ = cv2.estimateAffinePartial2D(src_landmarks, ARCFACE_REF)

        if M is None:
            return None

        # Warp the crop to 112×112 aligned face
        # We need to apply this to the ORIGINAL frame to get the right
        # pixels, but we only have the crop. The landmarks are in
        # original frame coords, so let's reconstruct from crop + bbox.
        # Actually, we stored the crop from frame[y1:y2, x1:x2], and
        # landmarks are in original frame space. We need to warp from
        # original frame space, but we only have the crop.
        # Solution: offset landmarks by -bbox origin, then align from crop.

        # Offset landmarks to crop-local space
        bbox_int = bbox.astype(int)
        src_local = src_landmarks.copy()
        src_local[:, 0] -= max(0, bbox_int[0])
        src_local[:, 1] -= max(0, bbox_int[1])

        M_local, _ = cv2.estimateAffinePartial2D(src_local, ARCFACE_REF)
        if M_local is None:
            return None

        aligned = cv2.warpAffine(crop, M_local, (112, 112), borderValue=0)
        return aligned

    def _forward(self, aligned: np.ndarray) -> np.ndarray:
        """
        Run ArcFace forward pass on a 112×112 aligned BGR face.
        Returns raw 512-d embedding (NOT normalized).
        """
        # Normalize: (pixel - 127.5) / 127.5, BGR → RGB, HWC → NCHW
        blob = (aligned.astype(np.float32) - 127.5) / 127.5
        blob = blob[:, :, ::-1]  # BGR → RGB
        blob = blob.transpose(2, 0, 1)[np.newaxis, ...]  # (1, 3, 112, 112)

        output = self.session.run(self.output_names, {self.input_name: blob})
        return output[0].flatten()