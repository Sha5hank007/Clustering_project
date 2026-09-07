"""FastAPI dependencies: Database session and model singletons."""

from __future__ import annotations

import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession

from db.session import AsyncSessionLocal
from pipeline.detector import Detector
from pipeline.embedder import FaceEmbedder

logger = logging.getLogger(__name__)

_detector_instance: Detector | None = None
_embedder_instance: FaceEmbedder | None = None


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that yields an async SQLAlchemy session."""
    async with AsyncSessionLocal() as session:
        yield session


def get_detector() -> Detector:
    """Dependency that provides singleton SCRFD face detector."""
    global _detector_instance
    if _detector_instance is None:
        logger.info("Initializing Detector singleton...")
        _detector_instance = Detector()
    return _detector_instance


def get_embedder() -> FaceEmbedder:
    """Dependency that provides singleton ArcFace face embedder."""
    global _embedder_instance
    if _embedder_instance is None:
        logger.info("Initializing FaceEmbedder singleton...")
        _embedder_instance = FaceEmbedder()
    return _embedder_instance
