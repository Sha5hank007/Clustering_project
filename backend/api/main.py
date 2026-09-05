"""
FastAPI application.

Run: uvicorn api.main:app --reload --port 8000
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routers import identify, persons, crops, stats, ingest
from api.deps import get_detector, get_embedder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

app = FastAPI(
    title="Face Track API",
    description="Face recognition and sighting history system",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(identify.router, prefix="/api")
app.include_router(persons.router, prefix="/api")
app.include_router(crops.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")


@app.on_event("startup")
def startup():
    """Pre-load ONNX models so first request isn't slow."""
    logging.info("Loading detector model...")
    get_detector()
    logging.info("Loading embedder model...")
    get_embedder()
    logging.info("API ready.")


@app.get("/api/health")
def health():
    return {"status": "ok"}