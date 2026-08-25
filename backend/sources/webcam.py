import cv2
import time
import numpy as np
from sources.base import FrameSource


class WebcamSource(FrameSource):
    """
    Desktop webcam via OpenCV.
    CAMERA_SOURCE=0 (or 1, 2 for multiple cameras) in .env
    """

    def __init__(self, device_id: int = 0):
        self.cap = cv2.VideoCapture(device_id)
        if not self.cap.isOpened():
            raise RuntimeError(
                f"Cannot open webcam device {device_id}. "
                f"Check if another app is using the camera."
            )

    def read(self) -> tuple[bool, np.ndarray | None, float]:
        ok, frame = self.cap.read()
        if not ok:
            return False, None, 0.0
        return ok, frame, time.time()

    def release(self) -> None:
        self.cap.release()