"""ArcFace embedding pipeline for face tracks."""

from __future__ import annotations

import os
from typing import Sequence

import cv2
import numpy as np
import onnxruntime as ort

from config import settings
from pipeline.tracker import CropInfo, Track


class FaceEmbedder:
    """Load the ArcFace ONNX recognizer and embed one track."""

    def __init__(self) -> None:
        model_path = os.path.join(settings.model_dir, settings.recognizer_model)
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Recognizer model not found at {model_path}. "
                f"Download the buffalo_l model pack and place the recognizer under {settings.model_dir}/"
            )

        sess_opts = ort.SessionOptions()
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_opts.intra_op_num_threads = max(1, os.cpu_count() or 1)
        sess_opts.log_severity_level = 3

        self.session = ort.InferenceSession(
            model_path,
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [output.name for output in self.session.get_outputs()]

    def embed_track(self, track: Track) -> np.ndarray:
        crop_infos = list(track.crops)
        if not crop_infos:
            raise ValueError(f"Track {track.track_id} has no crops to embed")

        embeddings = [self._embed_one(info) for info in crop_infos]
        stacked = np.vstack(embeddings).astype(np.float32)
        mean = stacked.mean(axis=0)
        return _normalize(mean)

    def embed_face(self, crop: np.ndarray, bbox: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        """Embed an individual face crop with bounding box and landmarks."""
        aligned = self._align_face(crop, bbox, landmarks)
        blob = self._preprocess(aligned)
        outputs = self.session.run(self.output_names, {self.input_name: blob})
        embedding = outputs[0]
        if isinstance(embedding, list):
            embedding = np.asarray(embedding)
        embedding = np.asarray(embedding).reshape(-1).astype(np.float32)
        return _normalize(embedding)

    def _embed_one(self, crop_info: CropInfo) -> np.ndarray:
        return self.embed_face(crop_info.crop, crop_info.bbox, crop_info.landmarks)

    def _preprocess(self, face_rgb: np.ndarray) -> np.ndarray:
        img = cv2.cvtColor(face_rgb, cv2.COLOR_BGR2RGB)
        img = cv2.resize(img, (112, 112), interpolation=cv2.INTER_LINEAR)
        img = img.astype(np.float32)
        img = (img - 127.5) / 128.0
        img = np.transpose(img, (2, 0, 1))[np.newaxis, ...]
        return img

    def _align_face(
        self,
        crop: np.ndarray,
        crop_bbox: np.ndarray,
        landmarks: np.ndarray,
    ) -> np.ndarray:
        if crop.size == 0 or landmarks.size == 0:
            return crop

        local = landmarks.copy().astype(np.float32)
        x1, y1, x2, y2 = crop_bbox.astype(int)
        local[:, 0] -= x1
        local[:, 1] -= y1

        if local.shape[0] < 5:
            return crop

        target = np.array(
            [
                [30.0, 30.0],
                [82.0, 30.0],
                [56.0, 56.0],
                [30.0, 94.0],
                [82.0, 94.0],
            ],
            dtype=np.float32,
        )

        src = local[:5]
        if crop.shape[:2] == (0, 0):
            return crop

        matrix, _ = cv2.estimateAffinePartial2D(src, target, method=cv2.RANSAC)
        if matrix is None:
            return crop

        aligned = cv2.warpAffine(
            crop,
            matrix,
            (112, 112),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT,
        )
        return aligned


def embed_track(track: Track) -> np.ndarray:
    return FaceEmbedder().embed_track(track)


def _normalize(vector: Sequence[float] | np.ndarray) -> np.ndarray:
    arr = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = np.linalg.norm(arr)
    if norm < 1e-12:
        return arr
    return arr / norm
