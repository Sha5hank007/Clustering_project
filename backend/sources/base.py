"""
    Abstract base class for all frame sources.
    - pipeline/worker.py calls source.read() in a loop
    - It doesn't know or care if frames come from a webcam, RTSP, or file
    - Swapping camera = swapping one class, zero changes in the pipeline

    Every implementation must return:
    - ok: bool         False means the source is dead (camera disconnected, file ended)
    - frame: ndarray   BGR image, shape (height, width, 3), dtype uint8
                       This is what OpenCV and ONNX models expect
    - timestamp: float Unix timestamp (seconds since epoch)
                         Used for seen_at in the sightings table
    """

from abc import ABC, abstractmethod
import numpy as np


class FrameSource(ABC):

    @abstractmethod
    def read(self) -> tuple[bool, np.ndarray | None, float]:
        ...

    @abstractmethod
    def release(self) -> None:
        """Release hardware resources (camera handle, file handle, thread)."""
        ...
        