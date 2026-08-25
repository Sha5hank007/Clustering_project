import cv2
import time
import numpy as np
from sources.base import FrameSource


class FileSource(FrameSource):
    """
    Video file source for testing with recorded footage.
    CAMERA_SOURCE=path/to/video.mp4 in .env

    loop=True (default): restarts from frame 0 when the file ends.
    Useful for development — record a 30-second clip of people walking
    past, loop it, and test the full pipeline without sitting in front
    of the camera all day.
    """

    def __init__(self, path: str, loop: bool = True):
        self.path = path
        self.loop = loop
        self.cap = cv2.VideoCapture(path)

        if not self.cap.isOpened():
            raise RuntimeError(f"Cannot open video file: {path}")

    def read(self) -> tuple[bool, np.ndarray | None, float]:
        ok, frame = self.cap.read()

        if not ok and self.loop:
            # Restart from beginning
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()

        if not ok:
            return False, None, 0.0

        # Use wall clock, not video timestamps — consistent with
        # webcam and RTSP sources, and what seen_at expects
        return ok, frame, time.time()

    def release(self) -> None:
        self.cap.release()