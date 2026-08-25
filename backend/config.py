"""
Central configuration. Reads all values from .env via pydantic-settings.
Every tunable threshold, path, and camera setting lives here.
No other file reads environment variables directly.
"""
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Camera
    camera_source: str = "0"
    camera_id: str = "default_cam"
    camera_roi: Optional[str] = None

    # Models
    model_dir: str = "./models"
    detector_model: str = "det_10g.onnx"
    recognizer_model: str = "w600k_r50.onnx"

    # Detection
    det_size: str = "320,320"
    det_threshold: float = 0.6
    detect_interval: int = 3
    fps_sample_rate: int = 5

    # Quality
    min_face_px: int = 80
    blur_threshold: float = 50.0
    max_yaw_degrees: int = 30

    # Tracker
    max_misses: int = 15
    iou_threshold: float = 0.3
    top_crops_per_track: int = 5

    # Identity
    match_threshold: float = 0.5
    query_threshold: float = 0.45
    cooldown_hours: int = 4

    # Storage
    retention_window_days: int = 2
    crop_storage_dir: str = "./data/crops"

    # Database
    postgres_user: str = "facetrack"
    postgres_password: str = "changeme"
    postgres_db: str = "facetrack"
    database_url: str = "postgresql+asyncpg://facetrack:changeme@localhost:5432/facetrack"

    # RTSP
    rtsp_buffer_size: int = 1
    rtsp_reconnect_delay: int = 5
    rtsp_max_reconnects: int = 50

    # Debug
    debug_display: bool = True

    @property
    def det_size_tuple(self) -> tuple[int, int]:
        w, h = self.det_size.split(",")
        return int(w.strip()), int(h.strip())

    @property
    def roi_tuple(self) -> Optional[tuple[int, int, int, int]]:
        if not self.camera_roi:
            return None
        parts = self.camera_roi.split(",")
        return tuple(int(p.strip()) for p in parts)

    @property
    def cooldown_seconds(self) -> int:
        return self.cooldown_hours * 3600

    @property
    def is_rtsp(self) -> bool:
        return self.camera_source.startswith("rtsp://")

    @property
    def is_webcam(self) -> bool:
        return self.camera_source.isdigit()

    @property
    def cv2_source(self):
        if self.is_webcam:
            return int(self.camera_source)
        return self.camera_source

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()