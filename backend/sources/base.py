"""
Abstract base class for all frame sources.
Every source implements read() -> (ok, frame, timestamp) and release().
The rest of the pipeline never knows whether frames come from
a webcam, RTSP stream, or video file.
"""
