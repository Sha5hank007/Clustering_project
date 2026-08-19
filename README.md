# Face Track

Automated face recognition and sighting history system. Watches camera feeds, identifies people by face embeddings, and builds a searchable history of sightings.

## Architecture

**Pipeline 1 — Ingestion (Phase 1)**
Camera → frame sampler → SCRFD detector → IoU tracker → quality gate → ArcFace embedder → identity matcher → PostgreSQL

**Pipeline 2 — Query (Phase 2)**
Owner uploads image → detect + embed → cosine match against known persons → return sighting history + stored crops

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Face Detection + Embedding | InsightFace (`buffalo_l` model pack) |
| Tracking | IoU + Hungarian assignment (no model) |
| Database | PostgreSQL 16 + pgvector |
| Backend API | FastAPI + SQLAlchemy 2.0 (async) |
| Frontend | React + TypeScript |
| Runtime | Docker Compose |

## Model Download

InsightFace models download **automatically on first run**. When you instantiate `FaceAnalysis(name="buffalo_l")`, it downloads the model pack (~1 GB) to:

```
~/.insightface/models/buffalo_l/
├── det_10g.onnx          # SCRFD detector (10 GFLOPs)
├── w600k_r50.onnx        # ArcFace recognizer (ResNet-50)
├── 1k3d68.onnx           # 3D landmarks (not used)
├── 2d106det.onnx         # 2D landmarks (not used)
└── genderage.onnx        # Gender/age (not used)
```

**To pre-download manually** (useful for Docker builds or offline machines):

```bash
python -c "
from insightface.app import FaceAnalysis
app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
app.prepare(ctx_id=-1, det_size=(320, 320))
print('Models downloaded to ~/.insightface/models/buffalo_l/')
"
```

**For `buffalo_s`** (lighter, faster on CPU):

```bash
python -c "
from insightface.app import FaceAnalysis
app = FaceAnalysis(name='buffalo_s', providers=['CPUExecutionProvider'])
app.prepare(ctx_id=-1, det_size=(320, 320))
print('Models downloaded to ~/.insightface/models/buffalo_s/')
"
```

**In Docker:** Models are downloaded during image build (see `backend/Dockerfile`). They persist in the image layer so containers don't re-download on every start.

## Setup

### 1. Clone and configure

```bash
git clone <repo-url>
cd face-track
cp .env.example .env
# Edit .env with your database credentials and camera settings
```

### 2. Start database

```bash
docker compose up db -d
```

### 3. Install dependencies and download models

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Download model pack (one time, ~1 GB)
python -c "
from insightface.app import FaceAnalysis
app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
app.prepare(ctx_id=-1, det_size=(320, 320))
"
```

### 4. Run migrations

```bash
alembic upgrade head
```

### 5. Start ingestion worker

```bash
python -m pipeline.worker
```

### 6. (Phase 2) Start API

```bash
uvicorn api.main:app --reload
```

## Project Structure

```
face-track/
├── .env.example              # template — copy to .env
├── docker-compose.yml
├── backend/
│   ├── config.py             # all settings from .env
│   ├── db/                   # models, session, migrations
│   ├── sources/              # camera abstraction (webcam/RTSP/file)
│   ├── pipeline/             # ingestion: detect → track → embed → match → store
│   ├── api/                  # FastAPI (phase 2)
│   ├── jobs/                 # nightly merge + retention sweep
│   └── utils/                # image helpers
├── frontend/                 # React app (phase 2)
└── data/crops/               # stored face crops (gitignored)
```

## Camera Configuration

Switch camera source by editing `.env`:

```env
# Desktop webcam
CAMERA_SOURCE=0

# Video file (for testing)
CAMERA_SOURCE=./test_video.mp4

# CCTV / RTSP stream (production)
CAMERA_SOURCE=rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101
```

No code changes needed.

## Development

### Multiple cameras (production)

Each camera runs as a separate worker with its own environment:

```bash
CAMERA_SOURCE=rtsp://...cam1... CAMERA_ID=entrance python -m pipeline.worker &
CAMERA_SOURCE=rtsp://...cam2... CAMERA_ID=lobby    python -m pipeline.worker &
```

Or use `docker-compose.prod.yml` with one service per camera.
