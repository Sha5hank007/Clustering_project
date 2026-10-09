import pytest

from api.routers.streams import _is_valid_stream_url


@pytest.mark.parametrize(
    "url",
    [
        "rtsp://192.168.1.100:554/stream",
        "webcam://0",
        "webcam://12",
        "https://www.youtube.com/live/video-id",
        "youtube.com/live/video-id",
        "https://youtube.com/live/video-id?feature=share",
    ],
)
def test_accepts_supported_stream_urls(url):
    assert _is_valid_stream_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "",
        "http://example.com/video",
        "rtsp://",
        "rtsp://camera:invalid-port/stream",
        "rtsp://camera:0/stream",
        "webcam://",
        "webcam://camera",
        "https://www.youtube.com/watch?v=video-id",
        "https://youtube.com/live/",
        "https://youtu.be/video-id",
    ],
)
def test_rejects_unsupported_or_malformed_stream_urls(url):
    assert not _is_valid_stream_url(url)
