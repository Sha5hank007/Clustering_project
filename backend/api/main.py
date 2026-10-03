"""FastAPI application for Face-Track.

Provides:
- Lifespan preloading of SCRFD & ArcFace ONNX models
- CORS middleware for React frontend
- Routers: identify, persons, crops, stats, ingest
- Health check endpoints
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.deps import get_detector, get_embedder
from api.routers import identify, persons, crops, stats, ingest
from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("face_track_api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager: preload AI models on startup."""
    logger.info("Initializing Face-Track API server...")
    try:
        get_detector()
        get_embedder()
        logger.info("InsightFace (SCRFD + ArcFace) models preloaded successfully.")
    except Exception as exc:
        logger.warning(
            f"Note: Model preloading failed or models not downloaded yet: {exc}"
        )
    yield
    logger.info("Shutting down Face-Track API server.")


app = FastAPI(
    title="Face Track API",
    description="Automated face recognition, sighting history, and forensic identification API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(identify.router, prefix="/api")
app.include_router(persons.router, prefix="/api")
app.include_router(crops.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")


@app.get("/api/health", tags=["Health"], summary="Health check endpoint")
async def health_check():
    """Returns service health status and model versions."""
    return {
        "status": "online",
        "service": "face-track",
        "version": "1.0.0",
        "models": {
            "detector": settings.detector_model,
            "recognizer": settings.recognizer_model,
        },
        "thresholds": {
            "match": settings.match_threshold,
            "query": settings.query_threshold,
        },
    }


@app.get("/", tags=["Health"], summary="Root endpoint")
async def root():
    return {
        "message": "Face Track API is active",
        "docs": "/docs",
        "health": "/api/health",
    }
