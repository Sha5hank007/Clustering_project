"""
RTSP/CCTV source with dedicated reader thread.
- Keeps only the latest frame (prevents buffer lag)
- Auto-reconnects on stream drop with configurable backoff
- Uses CAP_PROP_BUFFERSIZE=1 to avoid OpenCV internal buffering
CAMERA_SOURCE=rtsp://user:pass@ip:port/path in .env.
"""
