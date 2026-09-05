
# Face Track

Automated face recognition and sighting history system. Processes video footage from any source, identifies faces using deep learning, builds a searchable database of every person seen, and enables forensic identification by uploading a suspect's photo.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Video Upload API                                           │
│  POST /api/ingest → save file → queue job                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Ingest Worker (background process)                         │
│                                                             │
│  Video → Frame Sampling (5fps) → SCRFD Face Detection       │
│  → Quality Gate (blur/size/pose) → IoU Tracker              │
│  → Track Death → ArcFace Embedding (512-d vector)           │
│  → Cosine Match Against Known Persons → Store in DB         │
│                                                             │
│  Processes in 5-min chunks with crash resume                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL + pgvector                                      │
│                                                             │
│  persons      — centroid embeddings + metadata              │
│  sightings    — every visit with timestamp + camera          │
│  ingest_jobs  — upload queue + progress tracking             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Identification API                                         │
│  POST /api/identify → upload suspect photo → find matches   │
│  Response: person history, timestamps, cameras, face crops  │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component        | Technology                                  |
| ---------------- | ------------------------------------------- |
| Face Detection   | SCRFD (det_10g.onnx) via ONNX Runtime       |
| Face Recognition | ArcFace (w600k_r50.onnx) via ONNX Runtime   |
| Face Tracking    | IoU + center distance (no model, pure math) |
| Database         | PostgreSQL 16 + pgvector                    |
| Backend API      | FastAPI + psycopg2                          |
| Video I/O        | OpenCV                                      |
| Configuration    | pydantic-settings + .env                    |

## Project Structure

```
face-track/
├── .env.example
├── docker-compose.yml
├── backend/
│   ├── config.py                 — all settings from .env
│   ├── alembic.ini
│   │
│   ├── db/
│   │   ├── models.py             — Person, Sighting, IngestJob ORM models
│   │   ├── session.py            — async engine (for future use)
│   │   └── migrations/versions/
│   │       ├── 001_initial.py    — persons + sightings tables
│   │       └── 002_ingest_jobs.py — ingest_jobs table + job_id on sightings
│   │
│   ├── sources/                  — frame acquisition
│   │   ├── base.py               — FrameSource abstract interface
│   │   ├── webcam.py             — desktop camera
│   │   ├── rtsp.py               — CCTV with reconnection
│   │   ├── file.py               — video files with seek/resume
│   │   └── factory.py            — creates source from .env
│   │
│   ├── pipeline/                 — ingestion pipeline
│   │   ├── detector.py           — SCRFD ONNX face detection
│   │   ├── quality.py            — blur, size, pose filtering
│   │   ├── tracker.py            — multi-face IoU tracker
│   │   ├── embedder.py           — ArcFace alignment + embedding
│   │   ├── matcher.py            — cosine search, person create/update
│   │   ├── cooldown.py           — duplicate suppression (configurable window)
│   │   ├── retention.py          — crop storage policy
│   │   ├── worker.py             — live camera worker (debug/testing)
│   │   └── ingest_worker.py      — async video processing with chunking
│   │
│   ├── api/                      — REST API
│   │   ├── main.py               — FastAPI app, CORS, model preloading
│   │   ├── deps.py               — shared dependencies
│   │   └── routers/
│   │       ├── ingest.py         — video upload + job status
│   │       ├── identify.py       — suspect photo identification
│   │       ├── persons.py        — person CRUD + labeling
│   │       ├── crops.py          — serve face crop images
│   │       └── stats.py          — dashboard statistics
│   │
│   └── models/                   — ONNX model files (gitignored)
│       ├── det_10g.onnx
│       └── w600k_r50.onnx
│
├── data/
│   ├── crops/                    — stored face images (gitignored)
│   └── ingest/                   — temp uploaded videos (gitignored)
│
└── frontend/                     — React UI (in development)
```

## Setup

### Prerequisites

- Python 3.11+
- PostgreSQL with pgvector extension

### Installation

```bash
cd face-track/backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux/Mac
source .venv/bin/activate

pip install -r requirements.txt
```

### Configuration

```bash
copy .env.example .env
```

Edit `.env` and set your database credentials:

```env
DATABASE_URL=postgresql+asyncpg://your_user:your_password@localhost:5432/facetrack
```

### Database Setup

```sql
CREATE DATABASE facetrack;
\c facetrack
CREATE EXTENSION vector;
```

```bash
alembic upgrade head
```

### Model Download

Download `buffalo_l.zip` from https://github.com/deepinsight/insightface/releases/tag/v0.7

Extract and place these two files in `backend/models/`:

```
backend/models/
├── det_10g.onnx      (SCRFD face detector)
└── w600k_r50.onnx    (ArcFace face recognizer)
```

Delete the other .onnx files from the zip — they're not needed.

### Running

Two terminals required:

```bash
# Terminal 1 — API server
cd backend
uvicorn api.main:app --reload --port 8000

# Terminal 2 — Background ingest worker
cd backend
python -m pipeline.ingest_worker
```

### Testing

Open http://localhost:8000/docs for interactive Swagger UI.

**Upload a video for processing:**

```bash
curl -X POST http://localhost:8000/api/ingest \
  -F "video=@video.mp4" \
  -F "camera_id=entrance" \
  -F "recorded_at=2026-08-27T14:00:00"
```

**Check processing status:**

```bash
curl http://localhost:8000/api/ingest/status/{job_id}
```

**Identify a person:**

```bash
curl -X POST http://localhost:8000/api/identify -F "image=@suspect.jpg"
```

**List all known persons:**

```bash
curl http://localhost:8000/api/persons
```

**Label a person:**

```bash
curl -X PATCH http://localhost:8000/api/persons/1/label \
  -H "Content-Type: application/json" \
  -d '{"label": "John"}'
```

## API Endpoints

| Method | Endpoint                        | Description                            |
| ------ | ------------------------------- | -------------------------------------- |
| POST   | `/api/ingest`                 | Upload video for background processing |
| GET    | `/api/ingest/status/{job_id}` | Check job progress                     |
| GET    | `/api/ingest/jobs`            | List all ingest jobs                   |
| POST   | `/api/identify`               | Upload suspect photo, find matches     |
| GET    | `/api/persons`                | List all persons (paginated)           |
| GET    | `/api/persons/{id}`           | Person detail + sighting history       |
| PATCH  | `/api/persons/{id}/label`     | Assign name to a person                |
| DELETE | `/api/persons/{id}`           | Remove person + all data               |
| GET    | `/api/crops/{path}`           | Serve stored face images               |
| GET    | `/api/stats`                  | Dashboard statistics                   |
| GET    | `/api/health`                 | Health check                           |

## How It Works

### Ingestion Pipeline

1. **Frame Sampling** — video at 25fps is sampled at 5fps. 80% of frames are never decoded.
2. **Face Detection** — SCRFD detects faces, returns bounding boxes + 5 landmarks per face.
3. **Quality Gate** — rejects faces that are too small (<80px), blurry (Laplacian variance), or turned sideways (>30° yaw).
4. **Tracking** — IoU + center distance matching links faces across frames. One track = one continuous appearance. The tracker stores the best 5 crops per track by quality score.
5. **Embedding** — only runs when a track dies (person leaves frame). Aligns the best crops using landmarks, runs ArcFace to produce a 512-dimensional vector. One embedding per visit, not per frame.
6. **Identity Matching** — cosine similarity against all known person centroids. Match above threshold → existing person. No match → new person created.
7. **Cooldown** — suppresses duplicate sightings within a configurable window (default 4 hours).
8. **Retention** — saves one best-quality face crop per person per 2-day window.

### Chunked Processing

Videos are processed in configurable chunks (default 5 minutes). After each chunk:

- All active tracks are flushed and processed
- Progress checkpoint is saved to database
- On crash, processing resumes from last checkpoint

### Identification

Upload a suspect's photo → detect face → generate embedding → cosine search against all stored person centroids → return full sighting history with timestamps, cameras, and face crops.

## Configuration

All settings are in `.env`. Key parameters:

| Setting                    | Default | Description                            |
| -------------------------- | ------- | -------------------------------------- |
| `DET_SIZE`               | 640,640 | Detection input resolution             |
| `DET_THRESHOLD`          | 0.6     | Minimum detection confidence           |
| `DETECT_INTERVAL`        | 3       | Run detection every Nth frame          |
| `FPS_SAMPLE_RATE`        | 5       | Frames to process per second           |
| `MIN_FACE_PX`            | 80      | Minimum face width in pixels           |
| `BLUR_THRESHOLD`         | 50.0    | Minimum sharpness (Laplacian variance) |
| `MAX_YAW_DEGREES`        | 30      | Maximum face rotation angle            |
| `MAX_MISSES`             | 15      | Frames before track dies               |
| `MATCH_THRESHOLD`        | 0.5     | Cosine similarity for person match     |
| `COOLDOWN_HOURS`         | 4       | Duplicate suppression window           |
| `RETENTION_WINDOW_DAYS`  | 2       | One crop per person per N days         |
| `CHUNK_DURATION_MINUTES` | 5       | Processing chunk size                  |
| `INGEST_WORKERS`         | 2       | Parallel processing workers            |

## Performance

- **Detection:** ~30ms per frame (SCRFD at 640×640 on CPU)
- **Embedding:** ~25ms per face crop (ArcFace)
- **Identification:** ~60ms per query (detect + embed + DB search)
- **Video processing:** ~2-3 minutes per 15 minutes of 1080p footage
- **Storage:** ~610 MB per year for 200 persons (embeddings + crops)

Note: Processing speed depends heavily on video codec. H.264 (standard CCTV output) processes at ~25x real-time. Non-standard codecs may be significantly slower.
