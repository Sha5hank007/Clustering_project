import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { IngestJob } from '../types';
import { cropUrl } from '../api/utils';
import AuthenticatedImage from '../components/AuthenticatedImage';
import Reveal from '../components/Reveal';
import { Link } from 'react-router-dom';

interface Shop {
  id: number;
  name: string;
}

interface Camera {
  camera_id: string;
  name: string;
}

function localDateTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function statusTone(status: string): 'done' | 'failed' | 'active' {
  const s = (status || '').toLowerCase();
  if (['completed', 'complete', 'done', 'finished', 'success', 'succeeded'].includes(s)) return 'done';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed';
  return 'active';
}

function statusLabel(status: string) {
  const s = (status || 'unknown').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

const FilmIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
);

export default function IngestPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cameraId, setCameraId] = useState('');
  const [recordedAt, setRecordedAt] = useState(localDateTime);
  const [shopId, setShopId] = useState<number | ''>('');
  const [shops, setShops] = useState<Shop[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<IngestJob | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [cropPage, setCropPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [shopError, setShopError] = useState('');
  const [cameraError, setCameraError] = useState('');

  const fetchJobs = async (requestedPage = page) => {
    try {
      const response = await api.get('/ingest/jobs', { params: { page: requestedPage, limit: 10 } });
      setJobs(response.data.jobs || []);
      setTotalPages(response.data.total_pages || 0);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to load upload jobs');
    }
  };

  const selectJob = async (jobId: string, requestedCropPage = 1) => {
    try {
      const response = await api.get(`/ingest/status/${jobId}`, { params: { page: requestedCropPage, limit: 12 } });
      setSelectedJob(response.data);
      setCropPage(response.data.crops_page || 1);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to load video details');
    }
  };

  useEffect(() => {
    fetchJobs(page);
    if (isAdmin) {
      api.get('/admin/shops')
        .then(response => setShops(response.data.shops || []))
        .catch((err: any) => setShopError(err.response?.data?.detail || 'Unable to load shops'));
    }
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [isAdmin, page]);

  useEffect(() => {
    if (isAdmin && !shopId) {
      setCameras([]);
      setCameraId('');
      return;
    }
    api.get('/cameras', { params: isAdmin ? { shop_id: shopId } : undefined })
      .then(response => {
        setCameras(response.data.cameras || []);
        setCameraError('');
      })
      .catch((err: any) => {
        setCameraError(err.response?.data?.detail || 'Unable to load cameras');
        setCameras([]);
      });
  }, [isAdmin, shopId]);

  const clearFile = () => {
    setFile(null);
    const input = document.getElementById('video-file') as HTMLInputElement | null;
    if (input) input.value = '';
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError('Please choose a video file');
      return;
    }
    if (isAdmin && !shopId) {
      setError('Please select a shop');
      return;
    }
    if (!cameraId) {
      setError('Please select a registered camera');
      return;
    }

    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('video', file);
    form.append('camera_id', cameraId);
    form.append('recorded_at', new Date(recordedAt).toISOString());
    if (isAdmin) form.append('shop_id', String(shopId));

    try {
      await api.post('/ingest', form);
      clearFile();
      setCameraId('');
      setRecordedAt(localDateTime());
      setShopId('');
      setPage(1);
      await fetchJobs(1);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const cameraName = (id: string) => cameras.find(c => c.camera_id === id)?.name ?? id;

  const goToCropPage = (nextPage: number) => {
    setCropPage(nextPage);
    if (selectedJob?.job_id) selectJob(selectedJob.job_id, nextPage);
  };

  const renderDetails = (job: IngestJob) => {
    const cropPages = job.crops_total_pages || 1;
    return (
      <div className="ig-detail">
        <p className="ig-detail-meta">
          Camera {cameraName(job.camera_id)}
          {job.recorded_at && <><span className="ig-sep">·</span>Recorded {formatDate(job.recorded_at)}</>}
        </p>

        <dl className="ig-detail-stats">
          <div><dt>Status</dt><dd>{statusLabel(job.status)}</dd></div>
          <div>
            <dt>Frames</dt>
            <dd>
              {(job.processed_frame ?? 0).toLocaleString()}
              <span className="ig-faint"> / {job.total_frames != null ? job.total_frames.toLocaleString() : '—'}</span>
            </dd>
          </div>
          <div><dt>People</dt><dd>{job.persons_found}</dd></div>
          <div><dt>Sightings</dt><dd>{job.sightings_added}</dd></div>
        </dl>

        {job.error && <p className="ig-error" role="alert">{job.error}</p>}

        <div className="ig-gallery-head">
          <h3>Identified in this video</h3>
          {(job.crops_total ?? 0) > 0 && <span className="ig-faint">{job.crops_total} crops</span>}
        </div>

        {job.crops && job.crops.length > 0 ? (
          <>
            <div className="ig-gallery">
              {job.crops.map(crop => (
                <figure key={crop.id} className="ig-crop">
                  <div className="ig-crop-media">
                    {crop.crop_url ? (
                      <AuthenticatedImage
                        src={cropUrl(crop.crop_url)}
                        alt={crop.person_label || 'Detected person'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <span className="ig-crop-empty">No image</span>
                    )}
                  </div>
                  <figcaption>
                    <span className="ig-crop-name">{crop.person_label || 'Unknown'}</span>
                    <span className="ig-faint">{crop.camera_id}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            {cropPages > 1 && (
              <nav className="ig-pager" aria-label="Crop pages">
                <button type="button" onClick={() => goToCropPage(Math.max(1, (cropPage || 1) - 1))}
                  disabled={cropPage <= 1}>‹ Previous</button>
                <span>Page {cropPage} of {cropPages}</span>
                <button type="button" onClick={() => goToCropPage(Math.min(cropPages, (cropPage || 1) + 1))}
                  disabled={cropPage >= cropPages}>Next ›</button>
              </nav>
            )}
          </>
        ) : (
          <p className="ig-note">No one identified in this upload yet.</p>
        )}
      </div>
    );
  };

  const selectedInList = !!selectedJob && jobs.some(j => j.job_id === selectedJob.job_id);

  return (
    <div className="ig">
      <style>{styles}</style>

      <Reveal className="ig-header">
        <h1 className="ig-title">Upload</h1>
        <p className="ig-subtitle">Add recorded footage from a registered camera to process it.</p>
      </Reveal>

      <Reveal delay={80}>
        <form onSubmit={handleUpload} className="ig-form" noValidate>
          <label
            htmlFor="video-file"
            className={`ig-drop${dragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files?.[0];
              if (!dropped) return;
              if (dropped.type.startsWith('video/')) { setFile(dropped); setError(''); }
              else setError('Please choose a video file');
            }}
          >
            <input
              id="video-file"
              type="file"
              accept="video/*"
              className="ig-file-input"
              onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }}
            />
            {file ? (
              <>
                <span className="ig-drop-icon"><FilmIcon /></span>
                <span className="ig-drop-file">
                  <span className="ig-drop-name">{file.name}</span>
                  <span className="ig-faint">{formatSize(file.size)}</span>
                </span>
                <button type="button" className="ig-text-btn"
                  onClick={e => { e.preventDefault(); clearFile(); }}>Remove</button>
              </>
            ) : (
              <>
                <span className="ig-drop-icon ig-drop-icon--lg"><UploadIcon /></span>
                <span className="ig-drop-title">Drop a video here</span>
                <span className="ig-drop-hint">or <span className="ig-link-text">browse your files</span></span>
              </>
            )}
          </label>

          {isAdmin && (
            <label className="ig-field">
              <span className="ig-field-label">Shop</span>
              <select
                className="ig-input"
                value={shopId}
                onChange={e => {
                  setShopId(e.target.value ? Number(e.target.value) : '');
                  setCameraId('');
                }}
              >
                <option value="">Select a shop</option>
                {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
              </select>
              {shopError && <span className="ig-field-error">{shopError}</span>}
            </label>
          )}

          <div className="ig-row">
            <label className="ig-field">
              <span className="ig-field-label">Camera</span>
              <select
                className="ig-input"
                value={cameraId}
                onChange={e => setCameraId(e.target.value)}
                disabled={cameras.length === 0}
              >
                <option value="">Select a camera</option>
                {cameras.map(camera => (
                  <option key={camera.camera_id} value={camera.camera_id}>{camera.name} ({camera.camera_id})</option>
                ))}
              </select>
            </label>
            <label className="ig-field">
              <span className="ig-field-label">Recorded at</span>
              <input
                className="ig-input"
                type="datetime-local"
                value={recordedAt}
                onChange={e => setRecordedAt(e.target.value)}
              />
            </label>
          </div>

          {cameraError && <p className="ig-error" role="alert">{cameraError}</p>}
          {!cameraError && cameras.length === 0 && (
            <p className="ig-note">
              {isAdmin && !shopId
                ? 'Choose a shop to see its cameras.'
                : <>No active cameras are registered for this shop. An admin or manager can add one on the <Link className="ig-link" to="/cameras">Cameras page</Link>.</>}
            </p>
          )}
          {error && <p className="ig-error" role="alert">{error}</p>}

          <div>
            <button type="submit" disabled={uploading} className="ig-button">
              {uploading && <span className="ig-spinner" aria-hidden="true" />}
              {uploading ? 'Uploading…' : 'Upload video'}
            </button>
          </div>
        </form>
      </Reveal>

      <Reveal delay={160}>
        <section className="ig-jobs" aria-labelledby="ig-jobs-title">
          <div className="ig-section-head">
            <h2 className="ig-section-title" id="ig-jobs-title">Recent uploads</h2>
            {totalPages > 1 && <span className="ig-faint">Page {page} of {totalPages}</span>}
          </div>

          {selectedJob && !selectedInList && (
            <div className="ig-orphan">
              <div className="ig-orphan-head">
                <strong>{selectedJob.original_name}</strong>
                <button type="button" className="ig-text-btn" onClick={() => setSelectedJob(null)}>Close</button>
              </div>
              {renderDetails(selectedJob)}
            </div>
          )}

          {jobs.length === 0 ? (
            <p className="ig-note ig-note--empty">No uploads yet. Your videos will appear here.</p>
          ) : (
            <ul className="ig-job-list">
              {jobs.map(job => {
                const tone = statusTone(job.status);
                const pct = Math.min(100, Math.max(0, job.progress_percent || 0));
                const isOpen = selectedJob?.job_id === job.job_id;
                return (
                  <li key={job.job_id} className={`ig-job-item${isOpen ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="ig-job"
                      aria-expanded={isOpen}
                      onClick={() => (isOpen ? setSelectedJob(null) : selectJob(job.job_id, 1))}
                    >
                      <span className="ig-job-icon"><FilmIcon /></span>
                      <span className="ig-job-main">
                        <span className="ig-job-name">{job.original_name}</span>
                        <span className="ig-job-meta">
                          {cameraName(job.camera_id)}
                          {job.recorded_at && <><span className="ig-sep">·</span>{formatDate(job.recorded_at)}</>}
                        </span>
                      </span>
                      <span className={`ig-status ig-status--${tone}`}>
                        <span className="ig-status-dot" aria-hidden="true" />
                        {tone === 'active' ? `${pct.toFixed(0)}%` : statusLabel(job.status)}
                      </span>
                      <span className="ig-job-chevron" aria-hidden="true">›</span>
                    </button>
                    {tone === 'active' && (
                      <div className="ig-progress" role="progressbar" aria-valuenow={Math.round(pct)}
                        aria-valuemin={0} aria-valuemax={100} aria-label={`${job.original_name} progress`}>
                        <span style={{ transform: `scaleX(${pct / 100})` }} />
                      </div>
                    )}
                    {isOpen && selectedJob && renderDetails(selectedJob)}
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 && (
            <nav className="ig-pager" aria-label="Upload pages">
              <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))}
                disabled={page === 1}>‹ Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}>Next ›</button>
            </nav>
          )}
        </section>
      </Reveal>
    </div>
  );
}

const styles = `
.ig {
  --ig-text: #1d1d1f;
  --ig-muted: #6e6e73;
  --ig-faint: #86868b;
  --ig-line: rgba(0, 0, 0, 0.08);
  --ig-soft: rgba(0, 0, 0, 0.04);
  --ig-accent: #0071e3;
  --ig-accent-hover: #0077ed;
  --ig-green: #30d158;
  --ig-orange: #ff9f0a;
  --ig-red: #e30000;
  --ig-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  max-width: 880px;
  margin: 0 auto;
  padding: 56px 24px 112px;
  color: var(--ig-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Header */
.ig-header { padding-bottom: 36px; }
.ig-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}
.ig-subtitle { margin: 8px 0 0; font-size: 19px; color: var(--ig-muted); }

/* Form */
.ig-form { display: flex; flex-direction: column; gap: 22px; }

.ig-drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 24px;
  border: 1.5px dashed rgba(0, 0, 0, 0.16);
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.015);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.3s var(--ig-ease), background 0.3s var(--ig-ease), transform 0.3s var(--ig-ease);
}
.ig-drop:hover, .ig-drop.is-dragging { border-color: var(--ig-accent); background: rgba(0, 113, 227, 0.04); }
.ig-drop.is-dragging { transform: scale(1.01); }
.ig-drop:focus-within { border-color: var(--ig-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }
.ig-drop.has-file {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-style: solid;
  border-color: var(--ig-line);
  background: transparent;
  text-align: left;
}
.ig-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ig-drop-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--ig-soft);
  color: var(--ig-muted);
  flex-shrink: 0;
}
.ig-drop-icon--lg { width: 52px; height: 52px; margin-bottom: 8px; color: var(--ig-accent); background: rgba(0, 113, 227, 0.08); }
.ig-drop-title { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
.ig-drop-hint { font-size: 15px; color: var(--ig-muted); }
.ig-link-text { color: var(--ig-accent); }
.ig-drop-file { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ig-drop-name { font-size: 17px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.ig-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ig-field-label { font-size: 14px; font-weight: 500; color: var(--ig-muted); }
.ig-input {
  width: 100%;
  box-sizing: border-box;
  height: 48px;
  padding: 0 14px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 12px;
  background: #fff;
  color: var(--ig-text);
  font: inherit;
  font-size: 17px;
  transition: border-color 0.2s var(--ig-ease), box-shadow 0.2s var(--ig-ease);
}
select.ig-input {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 40px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%236e6e73' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
}
.ig-input:hover:not(:disabled) { border-color: rgba(0, 0, 0, 0.28); }
.ig-input:focus { outline: none; border-color: var(--ig-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }
.ig-input:disabled { color: var(--ig-faint); background-color: rgba(0, 0, 0, 0.02); cursor: not-allowed; }
.ig-field-error { font-size: 14px; color: var(--ig-red); }

.ig-note { margin: 0; font-size: 15px; color: var(--ig-muted); line-height: 1.5; }
.ig-note--empty { padding: 32px 0; font-size: 17px; }
.ig-error { margin: 0; font-size: 15px; color: var(--ig-red); line-height: 1.5; }
.ig-link { color: var(--ig-accent); text-decoration: none; }
.ig-link:hover { text-decoration: underline; }
.ig-faint { color: var(--ig-faint); font-size: 14px; }
.ig-sep { margin: 0 8px; color: var(--ig-faint); }

.ig-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 26px;
  border: none;
  border-radius: 980px;
  background: var(--ig-accent);
  color: #fff;
  font: inherit;
  font-size: 17px;
  cursor: pointer;
  transition: background 0.2s var(--ig-ease), transform 0.2s var(--ig-ease);
}
.ig-button:hover:not(:disabled) { background: var(--ig-accent-hover); }
.ig-button:active:not(:disabled) { transform: scale(0.98); }
.ig-button:disabled { opacity: 0.55; cursor: default; }
.ig-button:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.3); }
.ig-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ig-spin 0.8s linear infinite;
}
@keyframes ig-spin { to { transform: rotate(360deg); } }

.ig-text-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--ig-accent);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}
.ig-text-btn:hover { text-decoration: underline; }

/* Jobs */
.ig-jobs { margin-top: 88px; }
.ig-section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ig-line);
}
.ig-section-title { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }

.ig-job-list { list-style: none; margin: 0; padding: 0; }
.ig-job-item { border-bottom: 1px solid var(--ig-line); }
.ig-job {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 8px;
  margin: 0 -8px;
  box-sizing: content-box;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s var(--ig-ease);
}
.ig-job:hover { background: var(--ig-soft); }
.ig-job:focus-visible { outline: 2px solid var(--ig-accent); outline-offset: -2px; }
.ig-job-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--ig-soft);
  color: var(--ig-muted);
  flex-shrink: 0;
}
.ig-job-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ig-job-name { font-size: 17px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ig-job-meta { font-size: 14px; color: var(--ig-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ig-job-chevron {
  font-size: 22px;
  line-height: 1;
  color: var(--ig-faint);
  transition: transform 0.3s var(--ig-ease);
}
.ig-job-item.is-open .ig-job-chevron { transform: rotate(90deg); }

.ig-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  color: var(--ig-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ig-status-dot { position: relative; width: 7px; height: 7px; border-radius: 50%; }
.ig-status--done .ig-status-dot { background: var(--ig-green); }
.ig-status--failed .ig-status-dot { background: var(--ig-red); }
.ig-status--failed { color: var(--ig-red); }
.ig-status--active .ig-status-dot { background: var(--ig-orange); }
.ig-status--active .ig-status-dot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: ig-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes ig-ping { 75%, 100% { transform: scale(2.6); opacity: 0; } }

.ig-progress {
  height: 2px;
  margin: -2px 0 0;
  background: var(--ig-line);
  overflow: hidden;
}
.ig-progress span {
  display: block;
  height: 100%;
  background: var(--ig-accent);
  transform-origin: left;
  transition: transform 0.8s var(--ig-ease);
}

/* Details */
.ig-detail {
  padding: 8px 0 32px 50px;
  animation: ig-in 0.45s var(--ig-ease);
}
@keyframes ig-in { from { opacity: 0; transform: translateY(-6px); } }
.ig-detail-meta { margin: 0 0 20px; font-size: 15px; color: var(--ig-muted); }
.ig-detail-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin: 0 0 28px;
  border-top: 1px solid var(--ig-line);
  border-bottom: 1px solid var(--ig-line);
}
.ig-detail-stats > div { padding: 16px 16px 16px 0; }
.ig-detail-stats > div + div { border-left: 1px solid var(--ig-line); padding-left: 18px; }
.ig-detail-stats dt { font-size: 13px; color: var(--ig-muted); }
.ig-detail-stats dd {
  margin: 4px 0 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.015em;
  font-variant-numeric: tabular-nums;
}
.ig-detail .ig-error { margin: -12px 0 24px; }

.ig-gallery-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
.ig-gallery-head h3 { margin: 0; font-size: 17px; font-weight: 600; }
.ig-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 22px 16px; }
.ig-crop { margin: 0; }
.ig-crop-media {
  aspect-ratio: 3 / 4;
  border-radius: 14px;
  overflow: hidden;
  background: var(--ig-soft);
  display: grid;
  place-items: center;
}
.ig-crop-media img { transition: transform 0.5s var(--ig-ease); }
.ig-crop:hover .ig-crop-media img { transform: scale(1.04); }
.ig-crop-empty { font-size: 13px; color: var(--ig-faint); }
.ig-crop figcaption { display: flex; flex-direction: column; gap: 1px; margin-top: 10px; min-width: 0; }
.ig-crop-name { font-size: 15px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ig-orphan { padding: 18px 0 0; border-bottom: 1px solid var(--ig-line); }
.ig-orphan-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 17px; }
.ig-orphan .ig-detail { padding-left: 0; padding-top: 12px; }

.ig-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 24px;
  margin-top: 28px;
  font-size: 14px;
  color: var(--ig-faint);
}
.ig-pager button {
  padding: 6px 4px;
  border: none;
  background: none;
  color: var(--ig-accent);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}
.ig-pager button:disabled { color: rgba(0, 0, 0, 0.25); cursor: default; }
.ig-pager button:not(:disabled):hover { text-decoration: underline; }

/* Responsive */
@media (max-width: 720px) {
  .ig { padding: 40px 16px 80px; }
  .ig-row { grid-template-columns: 1fr; }
  .ig-drop { padding: 36px 20px; }
  .ig-jobs { margin-top: 64px; }
  .ig-job-meta { display: none; }
  .ig-detail { padding-left: 0; }
  .ig-detail-stats { grid-template-columns: repeat(2, 1fr); }
  .ig-detail-stats > div + div { border-left: none; padding-left: 0; }
  .ig-detail-stats > div:nth-child(even) { border-left: 1px solid var(--ig-line); padding-left: 16px; }
  .ig-detail-stats > div:nth-child(n + 3) { border-top: 1px solid var(--ig-line); }
  .ig-gallery { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 18px 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .ig *, .ig *::after { animation: none !important; transition: none !important; }
}
`;