# FaceTrack

FaceTrack indexes people seen in uploaded video or live camera streams. It uses SCRFD face detection and ArcFace embeddings, stores people and sightings in PostgreSQL with pgvector, and provides a React interface for search and administration.

## Project Layout

```text
face-track/
├── backend/
│   ├── .env.example       # Copy to backend/.env
│   ├── models/            # ONNX files go here
│   ├── api/               # FastAPI application and routers
│   └── pipeline/          # Video processing worker
├── data/
│   ├── ingest/            # Uploaded source videos
│   └── crops/             # Saved face crops
├── frontend/              # React + Vite application
└── docker-compose.yml     # PostgreSQL + pgvector service
```

## Requirements

- Python 3.11 or newer
- Node.js 18 or newer and npm
- Docker Desktop with Compose, or a PostgreSQL 16 server with the `vector` extension
- The two ONNX models described below

## 1. Configure the Environment

The backend reads its configuration from **`backend/.env`**. From the repository root, copy the example:

```powershell
Copy-Item backend/.env.example backend/.env
```

Or in Linux/WSL:

```bash
cp backend/.env.example backend/.env
```

The example contains the complete set of supported settings; keep its defaults or edit only the values you need to customize. Ensure `DATABASE_URL` matches your PostgreSQL credentials. The included Compose database defaults are `facetrack` / `changeme` / `facetrack` (user / password / database). Paths in this file are relative to the backend process working directory; run the backend commands from `backend/`.

Every sighting that passes the per-person, per-camera cooldown is saved as a database record with its own face-crop JPEG. Crops are resized to 112×112 and stored under `data/crops/person_<id>/`. The person's sighting count tracks inserted sighting records; the database migration corrects existing counts to match their records.

Google sign-in is optional. To enable it, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env` and configure this authorized redirect URI in Google Cloud:

```text
http://localhost:8000/api/auth/google/callback
```

## 2. Download the Face Models

Download the official **buffalo_l** model archive from the [InsightFace v0.7 release](https://github.com/deepinsight/insightface/releases/tag/v0.7) (`buffalo_l.zip`, approximately 275 MB). The [direct archive link](https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip) is also available.

Extract the archive and copy these two files into **`backend/models/`**:

```text
backend/models/det_10g.onnx       # SCRFD face detector
backend/models/w600k_r50.onnx     # ArcFace face recognizer
```

The configured names must match `DETECTOR_MODEL` and `RECOGNIZER_MODEL` in `backend/.env`. The application loads these files when the API starts; it will fail startup if they are missing. The models are not stored in this repository. Review the model publisher's licensing terms before use.

## 3. Start PostgreSQL and Initialize the Database

From the repository root, start the PostgreSQL 16 + pgvector container:

```bash
docker compose up -d db
```

Create the backend environment and install dependencies. Run the commands from `backend/`:

```powershell
cd backend
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Linux/WSL alternative:

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Apply all database migrations and create the first admin account:

```bash
alembic upgrade head
python create_admin.py
```

The admin creation command prompts for an email and password. Sign in with those credentials, then create shops and manager/guard accounts in the UI or through the admin API.

To use an existing local PostgreSQL installation instead of Docker, create a database named `facetrack`, enable pgvector with `CREATE EXTENSION vector;`, and set `DATABASE_URL` to that server before running migrations.

## 4. Run the Application

Run each process in its own terminal. Activate the backend virtual environment and use `backend/` as the working directory for both backend commands.

**Terminal 1: API**

```bash
cd backend
# Activate .venv if it is not already active
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

The API loads the ONNX models at startup. Interactive API documentation is at <http://localhost:8000/docs>; health check: <http://localhost:8000/api/health>.

**Terminal 2: video ingest worker**

```bash
cd backend
# Activate .venv if it is not already active
python -m pipeline.ingest_worker
```

The API accepts video uploads and queues jobs; the worker must be running to process those queued jobs.

**Terminal 3: frontend**

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. Vite proxies `/api` calls to `http://127.0.0.1:8000`. The frontend also uses `http://localhost:8000` directly for authenticated crop image fetches.

## Authentication and Roles

Sign-in returns a JWT. Send it on protected API requests as:

```http
Authorization: Bearer <token>
```

The frontend attaches this header automatically. `/api/health`, login, and Google OAuth entry/callback are public; other API routes require authentication. Admins can access data across shops in their tenant. Managers and guards are scoped to their assigned shop. Admin upload, stream creation, and identification filters can specify shop IDs where noted below.

## API Reference

All routes use the `/api` prefix. Interactive request schemas are also available from `/docs` while the API is running.

### Auth

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/login` | JSON `{ "email": "...", "password": "..." }`; returns JWT and user information. |
| `GET` | `/auth/me` | Return current user identity and role. |
| `GET` | `/auth/google/login` | Begin optional Google OAuth. |
| `GET` | `/auth/google/callback` | OAuth callback; user must already exist in FaceTrack. |

### Video Ingestion

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/ingest` | Multipart form: `video`, `camera_id`, `recorded_at` (ISO-8601), and `shop_id` for admins. Managers/guards use their assigned shop. Returns a queued `job_id`. |
| `GET` | `/ingest/jobs?page=1&limit=10` | Paginated jobs visible to the current user's shop/tenant. Returns `jobs`, `total`, `page`, `limit`, and `total_pages`. |
| `GET` | `/ingest/status/{job_id}` | Full processing status, progress, counts, and any error. |

Job statuses include `queued`, `processing`, `paused`, `complete`, and `failed`.

### Identification and People

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/identify` | Multipart form: `image`; optional `camera_id`; admins may repeat `shop_ids` to search selected tenant shops (omit for all tenant shops). Returns best match and sightings. |
| `GET` | `/persons?page=1&limit=20` | Paginated people in the caller's scope; optional `job_id` limits results to one uploaded video. |
| `GET` | `/persons/{person_id}?page=1&limit=20` | Person details and paginated sightings; optional `job_id` filter. |
| `PATCH` | `/persons/{person_id}/label` | JSON `{ "label": "Name" }`; admin/manager only. |
| `DELETE` | `/persons/{person_id}` | Delete a person and associated data; admin/manager only. |
| `GET` | `/crops/{person_folder}/{filename}` | Read a crop image after scope authorization. |

### Live Streams

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/streams` | JSON `{ "name": "Entrance", "url": "rtsp://...", "camera_id": "cam-01", "shop_id": 1 }`. Admins must provide a tenant shop; managers/guards use their assigned shop. The camera must be active and registered to that shop. Supported URLs are RTSP (`rtsp://host/path`), a local worker webcam (`webcam://0`), and YouTube Live (`youtube.com/live/<video-id>`). The API validates the URL format; the worker checks whether the source can actually be opened. YouTube Live requires `YT_DLP_PATH` to be configured on the server. |
| `GET` | `/streams` | List streams in the caller's scope. |
| `GET` | `/streams/{stream_id}` | Stream details. |
| `PATCH` | `/streams/{stream_id}/pause` | Pause a running stream. |
| `PATCH` | `/streams/{stream_id}/resume` | Resume a paused stream. |
| `PATCH` | `/streams/{stream_id}/stop` | Stop a stream; admin/manager only. |
| `DELETE` | `/streams/{stream_id}` | Stop and remove the stream record; admin/manager only. |

### Cameras

Camera IDs are registered per shop and must be selected for both live streams and video uploads. Admins select a shop in their tenant; managers manage cameras for their assigned shop; guards can use active cameras in their assigned shop but cannot manage the registry. Camera IDs are unique within a shop. Deactivated cameras remain linked to historical records.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/cameras?shop_id=1` | List active cameras in the caller's shop. Tenant admins must supply a shop ID. |
| `GET` | `/cameras?shop_id=1&include_inactive=true` | List active and inactive cameras; admin/manager only see inactive entries. |
| `POST` | `/cameras` | Register `{ "camera_id": "cam-01", "name": "Front Door", "shop_id": 1 }`; admin/manager only. Managers are scoped to their assigned shop. |
| `PATCH` | `/cameras/{camera_id}?shop_id=1` | Update the display name or `is_active`; admin/manager only. Camera IDs are immutable to preserve historical associations. |

### Administration and Stats

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/admin/tenants` | Create tenant; admin only. |
| `POST` | `/admin/shops` | JSON `{ "name": "Shop", "address": "..." }`; admin only. |
| `GET` | `/admin/shops` | List shops in the admin's tenant. |
| `POST` | `/admin/users` | Create a user with `email`, `password`, `role` (`admin`, `manager`, or `guard`), and `shop_id` where required. |
| `GET` | `/admin/users` | List users visible to admin/manager. |
| `DELETE` | `/admin/users/{user_id}` | Delete a user visible to admin/manager; cannot delete yourself. |
| `PATCH` | `/admin/jobs/{job_id}/control` | JSON `{ "action": "pause" }`, `resume`, or `cancel`; admin/manager only. |
| `GET` | `/stats` | Scoped counts and distinct camera IDs for the dashboard and camera filters. |
| `GET` | `/health` | API health status; no authentication required. |

## Useful Configuration

All values can be set in `backend/.env`; defaults are defined in `backend/config.py`.

| Variable | Default | Description |
|---|---:|---|
| `DATABASE_URL` | Local PostgreSQL URL | Database connection. |
| `MODEL_DIR` | `./models` | Model directory relative to `backend/`. |
| `DETECTOR_MODEL` | `det_10g.onnx` | SCRFD ONNX filename. |
| `RECOGNIZER_MODEL` | `w600k_r50.onnx` | ArcFace ONNX filename. |
| `DET_SIZE` | `320,320` | Detector input width and height. |
| `FPS_SAMPLE_RATE` | `5` | Video frames sampled per second. |
| `CHUNK_DURATION_MINUTES` | `5` | Ingest processing chunk length. |
| `INGEST_WORKERS` | `2` | Concurrent ingest workers. |
| `INGEST_DIR` | `../data/ingest` | Uploaded video storage. |
| `CROP_STORAGE_DIR` | `../data/crops` | Saved face crop storage. |
| `JWT_SECRET` | Development placeholder | Set a long random value outside local development. |
| `JWT_EXPIRY_HOURS` | `24` | JWT lifetime. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Empty | Optional Google OAuth credentials. |

## Troubleshooting

- **API exits while starting:** confirm both ONNX files exist under `backend/models/` and `MODEL_DIR` is correct.
- **Database connection error:** confirm PostgreSQL is running and the username/password/database in `DATABASE_URL` match the database service.
- **Uploads stay queued:** make sure `python -m pipeline.ingest_worker` is running from `backend/`.
- **No admin shops:** create at least one shop before creating manager/guard users or uploading as an admin.
- **Port already in use:** stop the existing process using port `8000` or `3000`, or change the API/frontend port and update the corresponding frontend/API URLs.