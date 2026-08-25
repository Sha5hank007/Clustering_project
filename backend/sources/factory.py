from config import settings
from sources.base import FrameSource
from sources.webcam import WebcamSource
from sources.rtsp import RTSPSource
from sources.file import FileSource


def create_source() -> FrameSource:
    """
    Reads CAMERA_SOURCE from .env and returns the right FrameSource.

    .env value               What gets created
    ──────────────────────────────────────────────
    CAMERA_SOURCE=0          WebcamSource(0)
    CAMERA_SOURCE=1          WebcamSource(1)
    CAMERA_SOURCE=rtsp://…   RTSPSource(url)
    CAMERA_SOURCE=video.mp4  FileSource(path)
    """

    if settings.is_webcam:
        return WebcamSource(int(settings.camera_source))
    elif settings.is_rtsp:
        return RTSPSource(settings.camera_source)
    else:
        return FileSource(settings.camera_source)