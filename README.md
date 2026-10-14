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

### YouTube Live streams (optional)

Only YouTube Live URLs need yt-dlp. RTSP and `webcam://` streams do not. The stream worker runs yt-dlp locally to resolve the YouTube Live URL, so install it on the same machine/environment that runs `pipeline.stream_worker`.

**Windows:** download the official `yt-dlp.exe` from the [yt-dlp GitHub releases](https://github.com/yt-dlp/yt-dlp/releases/latest), or run this from the `backend/` directory in PowerShell:

```powershell
New-Item -ItemType Directory -Force tools | Out-Null
Invoke-WebRequest `
  -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" `
  -OutFile "$PWD\tools\yt-dlp.exe"
.\tools\yt-dlp.exe --version
```

Set `YT_DLP_PATH` in `backend/.env` to that executable's path. An absolute path is the least ambiguous:

```dotenv
YT_DLP_PATH=D:\MAANG_PYTHON\Clustering_project\face-track\backend\tools\yt-dlp.exe
```

Use the actual location of your checkout. If the path contains backslashes, keep it on one line and do not wrap it in quotes.

**Linux/WSL:** install yt-dlp inside the same WSL distribution used by the stream worker:

```bash
mkdir -p "$HOME/.local/bin"
curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" \
  -o "$HOME/.local/bin/yt-dlp"
chmod +x "$HOME/.local/bin/yt-dlp"
"$HOME/.local/bin/yt-dlp" --version
```

For a different Linux CPU architecture, choose its matching executable from the [yt-dlp GitHub releases](https://github.com/yt-dlp/yt-dlp/releases/latest). Set `YT_DLP_PATH` to the full executable path:

```dotenv
YT_DLP_PATH=/home/your-user/.local/bin/yt-dlp
```

A Windows `.exe` path cannot be used by a worker running in Linux/WSL, and a Linux path cannot be used by a Windows worker. Restart the stream worker after changing `.env`. To check a YouTube Live URL, the worker runs yt-dlp with `-f "best[ext=mp4]/best" -g`.

### SMTP for organization invitations (optional until provisioning)

SMTP is required when a superadmin creates an organization or resends its first-admin invitation. It is not required to run the app or create the initial superadmin.

- `SMTP_HOST`: your email provider's SMTP server hostname.
- `SMTP_PORT`: usually `587` for STARTTLS or `465` for implicit SSL; use the port given by your provider.
- `SMTP_USERNAME` and `SMTP_PASSWORD`: optional in this application, but most providers require authentication. `SMTP_USERNAME` is the SMTP account/login name (often an email address); use provider-issued SMTP credentials or an app password where required, not necessarily your normal email password. Leave both blank only when the server permits unauthenticated sending.
- `SMTP_FROM_EMAIL`: sender address accepted by your provider.
- `SMTP_USE_TLS=true` with `SMTP_USE_SSL=false` for STARTTLS (usually port 587), or `SMTP_USE_TLS=false` with `SMTP_USE_SSL=true` for implicit SSL (usually port 465). Do not enable both.
- `ORGANIZATION_INVITE_EXPIRY_HOURS`: one-time first-admin invite lifetime; default is 48 hours.

Copy the SMTP host, port, username, password, and permitted sender address from your mail provider. Keep `.env` private and never commit or share SMTP credentials.

Every detection is not necessarily a stored sighting: the per-person/per-camera cooldown (`COOLDOWN_HOURS`, default 4) suppresses duplicate records for that window. When a sighting is accepted and inserted, the app saves a database record and its own face-crop JPEG. Crops are resized to 112×112 and stored under `data/crops/person_<id>/`; there is no two-day crop deletion schedule. `sighting_count` counts inserted sighting records and migration 006 recalculates existing counts from those records. `embedding_count` is internal face-vector/centroid metadata, not a user-facing sighting count.

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

Apply all database migrations and create the first platform superadmin:

```bash
alembic upgrade head
python scripts/create_superadmin.py
```

The script prompts for an email and a hidden password (minimum 8 characters), and refuses to create the first superadmin if one already exists. To provision an additional trusted superadmin, use `python scripts/create_superadmin.py --additional`. Superadmins are platform operators: they create, suspend, and reactivate organizations, resend first-admin invitations, and review an audit trail, but cannot access organization operational data.

Configure SMTP in `backend/.env` before creating organizations. In the superadmin UI, create an organization and provide its first admin's email. FaceTrack emails a single-use setup link that expires after `ORGANIZATION_INVITE_EXPIRY_HOURS`; the invited admin chooses their own password. The organization admin then creates shops and manages users inside their organization. Managers and guards remain assigned to a shop.

The older `python create_admin.py` script is not the current setup path; use `python scripts/create_superadmin.py`.

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

**Terminal 3: live-stream worker**

```bash
cd backend
# Activate .venv if it is not already active
python -m pipeline.stream_worker
```

The stream worker processes configured live streams. Install yt-dlp and set `YT_DLP_PATH` in the same environment only when you use YouTube Live sources.

**Terminal 4: frontend**

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

The frontend attaches this header automatically. Health, login, invitation validation/acceptance, and Google OAuth entry/callback are public; other API routes require authentication. Superadmins can provision, suspend, and reactivate organizations and view platform audit events, but cannot access organization operational data. Each organization's admins can access data across shops in their tenant. Managers and guards are scoped to their assigned shop. Suspending an organization blocks sign-in and subsequent authenticated API requests for its users. Admin upload, stream creation, and identification filters can specify shop IDs where noted below.

### Current operational workflows

- **Organizations and roles:** the initial platform superadmin is bootstrapped from the backend script. Superadmins provision organizations and invite each first admin; organization admins manage users and shops for their own organization. Managers and guards are shop-scoped. There is no public signup or public role selection.
- **Camera registration:** admin/manager users register cameras under a specific shop from the Cameras page. Upload and stream forms select a registered camera rather than accepting an arbitrary ID. Only active cameras can be used for new work; deactivating one preserves its historical records.
- **Stream sources:** users provide a stream URL; they do not choose a separate source type. The backend accepts RTSP, `webcam://<device-number>`, or a YouTube Live URL. It rejects malformed links, while the stream worker checks whether it can actually open the source. YouTube Live additionally requires yt-dlp.
- **Sightings and crops:** a detection must pass the per-person/per-camera cooldown before it is recorded. Every inserted sighting has its own crop and increments the person's sighting count. Crops are not batch-saved every two days or automatically deleted on a two-day schedule.
- **People display:** the person detail UI shows the sighting count; embedding counts are internal matching metadata rather than a user metric.

## API Reference

All routes use the `/api` prefix. Interactive request schemas are also available from `/docs` while the API is running.

### Auth

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/login` | JSON `{ "email": "...", "password": "..." }`; returns JWT and user information. |
| `GET` | `/auth/me` | Return current user identity and role. |
| `GET` | `/auth/invite-info?token=...` | Validate a first-admin invite link and return its organization/email. |
| `POST` | `/auth/accept-invite` | Set a password and activate the invited organization admin account. |
| `GET` | `/auth/google/login` | Begin optional Google OAuth. |
| `GET` | `/auth/google/callback` | OAuth callback; user must already exist in FaceTrack. |

### Superadmin

These routes require the tenantless `superadmin` role. Superadmins can manage organizations but cannot access their operational data.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/superadmin/organizations` | List organizations and first-admin invitation status. |
| `POST` | `/superadmin/organizations` | Create an organization and email a first-admin setup invitation. |
| `POST` | `/superadmin/organizations/{tenant_id}/resend-invite` | Revoke the previous pending link and send a new one. |
| `PATCH` | `/superadmin/organizations/{tenant_id}/status` | Suspend or reactivate an organization. |
| `GET` | `/superadmin/audit?limit=50` | List recent platform provisioning and status-change events. |

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
| `POST` | `/admin/shops` | JSON `{ "name": "Shop", "address": "..." }`; admin only. |
| `GET` | `/admin/shops` | List shops in the admin's tenant. |
| `POST` | `/admin/users` | Create an organization user with `email`, `password`, `role` (`admin`, `manager`, or `guard`), and `shop_id` where required. Organization creation and first-admin invitation are superadmin-only. |
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
| `COOLDOWN_HOURS` | `4` | Per-person, per-camera duplicate sighting suppression window. Crops are saved for sightings that pass this check; this is not a crop deletion interval. |
| `ORGANIZATION_INVITE_EXPIRY_HOURS` | `48` | Expiry for first-admin setup links. |
| `SMTP_HOST`, `SMTP_PORT` | Empty, `587` | Outbound mail server for organization invitations. |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Empty | Optional SMTP credentials; use TLS or SSL when authenticating. |
| `SMTP_FROM_EMAIL` | Empty | Sender address for organization invitations. |
| `SMTP_USE_TLS`, `SMTP_USE_SSL` | `true`, `false` | Choose STARTTLS or implicit SSL; enable only one. |
| `YT_DLP_PATH` | Example Windows path in `.env.example` | yt-dlp executable path for YouTube Live stream resolution; use a path valid on the stream-worker host. |
| `JWT_SECRET` | Development placeholder | Set a long random value outside local development. |
| `JWT_EXPIRY_HOURS` | `24` | JWT lifetime. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Empty | Optional Google OAuth credentials. |

## Troubleshooting

- **API exits while starting:** confirm both ONNX files exist under `backend/models/` and `MODEL_DIR` is correct.
- **Database connection error:** confirm PostgreSQL is running and the username/password/database in `DATABASE_URL` match the database service.
- **Uploads stay queued:** make sure `python -m pipeline.ingest_worker` is running from `backend/`.
- **No admin shops:** create at least one shop before creating manager/guard users or uploading as an admin.
- **Port already in use:** stop the existing process using port `8000` or `3000`, or change the API/frontend port and update the corresponding frontend/API URLs.