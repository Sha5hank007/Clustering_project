import cv2
import time
import numpy as np
from datetime import datetime, timedelta, timezone
from sources.base import FrameSource


class FileSource(FrameSource):
    """
    Video file source.

    Two modes:
      loop=True (default):  for testing with live worker, loops forever
      loop=False:           for ingestion, stops at end of file

    Supports:
      seek_to_frame():  resume from a specific frame after crash
      real timestamps:  if recorded_at is provided, timestamps reflect
                        actual recording time, not wall clock
    """

    def __init__(
        self,
        path: str,
        loop: bool = True,
        recorded_at: datetime | None = None,
    ):
        self.path = path
        self.loop = loop
        self.recorded_at = recorded_at
        self.cap = cv2.VideoCapture(path)

        import os as _os
        if not _os.path.exists(path):
            raise RuntimeError(
                f"Video file not found: {path}"
            )
        if not self.cap.isOpened():
            raise RuntimeError(
                f"Could not decode video file: {path}\n"
                "Tip: The file may be corrupted, incomplete, or not a supported format.\n"
                "For MP4s recorded without 'faststart', try: ffmpeg -i input.mp4 -movflags faststart output.mp4"
            )

        self._fps = self.cap.get(cv2.CAP_PROP_FPS) or 25.0
        self._total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def total_frames(self) -> int:
        return self._total_frames

    @property
    def current_frame(self) -> int:
        return int(self.cap.get(cv2.CAP_PROP_POS_FRAMES))

    def seek_to_frame(self, frame_number: int) -> None:
        """Seek to a specific frame. Used for resume after crash."""
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)

    def read(self) -> tuple[bool, np.ndarray | None, float]:
        ok, frame = self.cap.read()

        if not ok and self.loop:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()

        if not ok:
            return False, None, 0.0

        # Calculate timestamp: use recorded_at offset if available, else wall clock
        if self.recorded_at:
            frame_pos = self.cap.get(cv2.CAP_PROP_POS_FRAMES)
            offset = timedelta(seconds=frame_pos / self._fps)
            ts = (self.recorded_at + offset).timestamp()
        else:
            ts = time.time()

        return ok, frame, ts

    def release(self) -> None:
        self.cap.release()