import cv2
import time
import threading
import logging
import numpy as np
from sources.base import FrameSource
from config import settings

logger = logging.getLogger(__name__)


class RTSPSource(FrameSource):
    """
    RTSP/CCTV source with a dedicated reader thread.
      OpenCV buffers RTSP frames internally. If pipeline processes
      at 5 fps but the camera sends 25 fps, the buffer fills up and
      "live" feed drifts minutes behind reality. The reader thread
      grabs frames as fast as they arrive and always keeps only the
      LATEST one. When the pipeline calls read(), it gets the most
      recent frame, not one from 3 minutes ago.

    Reconnection:
      CCTV streams drop — network blips, camera reboots, NVR restarts.
      The reader thread detects failed reads and reconnects with a
      configurable delay (RTSP_RECONNECT_DELAY) up to a maximum
      number of attempts (RTSP_MAX_RECONNECTS).

    CAMERA_SOURCE=rtsp://user:pass@192.168.1.100:554/stream in .env
    """

    def __init__(self, url: str):
        self.url = url
        self.frame: np.ndarray | None = None
        self.timestamp: float = 0.0
        self.lock = threading.Lock()
        self.running = False
        self._connect()

    def _connect(self) -> None:
        self.cap = cv2.VideoCapture(self.url)
        # Force buffer size to 1 — only the latest frame matters
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, settings.rtsp_buffer_size)

        if not self.cap.isOpened():
            raise RuntimeError(f"Cannot open RTSP stream: {self.url}")

        self.running = True
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.thread.start()
        logger.info(f"Connected to RTSP stream: {self.url}")

    def _reader(self) -> None:
        """
        Runs in a background thread. Continuously grabs frames and
        overwrites self.frame with the latest one. If the stream drops,
        attempts reconnection with backoff.
        """
        reconnects = 0

        while self.running:
            ok, frame = self.cap.read()

            if ok:
                reconnects = 0
                with self.lock:
                    self.frame = frame
                    self.timestamp = time.time()
            else:
                reconnects += 1
                logger.warning(
                    f"RTSP read failed. Reconnect attempt {reconnects}/{settings.rtsp_max_reconnects}"
                )

                if reconnects > settings.rtsp_max_reconnects:
                    logger.error("Max reconnect attempts reached. Stopping.")
                    self.running = False
                    break

                time.sleep(settings.rtsp_reconnect_delay)
                self.cap.release()
                self.cap = cv2.VideoCapture(self.url)
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, settings.rtsp_buffer_size)

    def read(self) -> tuple[bool, np.ndarray | None, float]:
        with self.lock:
            if self.frame is None:
                return False, None, 0.0
            # .copy() because the reader thread will overwrite self.frame
            return True, self.frame.copy(), self.timestamp

    def release(self) -> None:
        self.running = False
        if hasattr(self, 'thread'):
            self.thread.join(timeout=3)
        self.cap.release()
        logger.info("RTSP source released.")