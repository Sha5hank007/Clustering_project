"""
FastAPI application.
Run: uvicorn api.main:app --reload --port 8000
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routers import auth, identify, persons, crops, stats, ingest, admin, streams
from api.deps import get_detector, get_embedder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

app = FastAPI(
    title="Face Track API",
    description="Face recognition and sighting history system with multi-tenancy",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(ingest.router, prefix="/api", tags=["Ingestion"])
app.include_router(streams.router, prefix="/api", tags=["Live Streams"])
app.include_router(identify.router, prefix="/api", tags=["Identification"])
app.include_router(persons.router, prefix="/api", tags=["Persons"])
app.include_router(crops.router, prefix="/api", tags=["Crops"])
app.include_router(stats.router, prefix="/api", tags=["Stats"])
app.include_router(admin.router, prefix="/api", tags=["Admin"])


@app.on_event("startup")
def startup():
    logging.info("Loading detector model...")
    get_detector()
    logging.info("Loading embedder model...")
    get_embedder()
    logging.info("API ready.")


@app.get("/api/health")
def health():
    return {"status": "ok"}