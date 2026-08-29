"""
Shared dependencies for API endpoints.

Detector and Embedder are loaded ONCE at startup (heavy ONNX models).
DB connections are created per-request.
"""
import psycopg2
from config import settings
from pipeline.detector import Detector
from pipeline.embedder import Embedder

# Convert asyncpg URL to psycopg2 format
_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

# Loaded once at module import — shared across all requests
_detector = None
_embedder = None


def get_detector() -> Detector:
    global _detector
    if _detector is None:
        _detector = Detector()
    return _detector


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        _embedder = Embedder()
    return _embedder


def get_db():
    """Yield a psycopg2 connection, auto-close after request."""
    conn = psycopg2.connect(_db_url)
    try:
        yield conn
    finally:
        conn.close()