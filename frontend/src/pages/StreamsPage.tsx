import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Reveal from '../components/Reveal';

interface Stream {
  stream_id: string;
  name: string;
  camera_id: string;
  url: string;
  status: string;
  persons_found: number;
  sightings_added: number;
  started_at: string | null;
  stopped_at: string | null;
}

interface Shop {
  id: number;
  name: string;
}

interface Camera {
  camera_id: string;
  name: string;
}

type Tone = 'live' | 'paused' | 'stopped' | 'failed' | 'pending';

function statusTone(status: string): Tone {
  switch ((status || '').toLowerCase()) {
    case 'running': return 'live';
    case 'paused': return 'paused';
    case 'stopped': return 'stopped';
    case 'error':
    case 'failed': return 'failed';
    default: return 'pending';
  }
}

function statusLabel(status: string) {
  if ((status || '').toLowerCase() === 'running') return 'Live';
  const s = (status || 'unknown').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function timeAgo(value: string | null) {
  if (!value) return null;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  const months = Math.round(days / 30);
  if (months < 12) return rtf.format(-months, 'month');
  return rtf.format(-Math.round(months / 12), 'year');
}

/** Hide any username/password embedded in a stream URL (e.g. rtsp://user:pass@host). */
function maskUrl(url: string) {
  return url.replace(/\/\/([^/@]+)@/, '//••••@');
}

type Source = 'rtsp' | 'webcam' | 'youtube' | 'link';

function sourceOf(url: string): { kind: Source; label: string } {
  if (url.startsWith('webcam://')) return { kind: 'webcam', label: 'Webcam' };
  if (url.startsWith('rtsp://')) return { kind: 'rtsp', label: 'RTSP' };
  if (url.includes('youtube.com') || url.includes('youtu.be')) return { kind: 'youtube', label: 'YouTube' };
  return { kind: 'link', label: 'Link' };
}

const iconProps = {
  viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
};

const SourceIcon = ({ kind }: { kind: Source }) => {
  switch (kind) {
    case 'rtsp':
      return (
        <svg {...iconProps}>
          <path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" />
          <rect x="3" y="6" width="12" height="12" rx="2" />
        </svg>
      );
    case 'webcam':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="10" r="7" /><circle cx="12" cy="10" r="2.5" /><path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...iconProps}>
          <rect x="2.5" y="5" width="19" height="14" rx="4" />
          <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps}>
          <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
        </svg>
      );
  }
};

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function StreamsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [streams, setStreams] = useState<Stream[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [shopId, setShopId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shopError, setShopError] = useState('');
  const [cameraError, setCameraError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  const fetchStreams = async () => {
    try {
      const res = await api.get('/streams');
      setStreams(res.data.streams || []);
    } catch {
      console.error('Failed to fetch streams');
    }
  };

  const fetchShops = async () => {
    try {
      const res = await api.get('/admin/shops');
      setShops(res.data.shops || []);
      setShopError('');
    } catch (err: any) {
      setShopError(err.response?.data?.detail || 'Unable to load shops');
    }
  };

  const fetchCameras = async () => {
    if (isAdmin && !shopId) {
      setCameras([]);
      setCameraId('');
      return;
    }
    try {
      const res = await api.get('/cameras', {
        params: isAdmin ? { shop_id: shopId } : undefined,
      });
      setCameras(res.data.cameras || []);
      setCameraError('');
    } catch (err: any) {
      setCameraError(err.response?.data?.detail || 'Unable to load cameras');
      setCameras([]);
    }
  };

  useEffect(() => {
    fetchStreams();
    if (isAdmin) fetchShops();
    const interval = setInterval(fetchStreams, 10000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  useEffect(() => {
    fetchCameras();
  }, [isAdmin, shopId]);

  const resetForm = () => {
    setName(''); setUrl(''); setCameraId(''); setShopId(''); setError('');
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAdmin && !shopId) {
      setError('Please select a shop');
      return;
    }
    if (!name.trim()) {
      setError('Please enter a stream name');
      return;
    }
    if (!cameraId) {
      setError('Please select a registered camera');
      return;
    }
    if (!url.trim()) {
      setError('Please enter a stream URL');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body: { name: string; url: string; camera_id: string; shop_id?: number } = {
        name: name.trim(), url: url.trim(), camera_id: cameraId,
      };
      if (isAdmin && shopId) body.shop_id = shopId;
      await api.post('/streams', body);
      resetForm();
      setFormOpen(false);
      fetchStreams();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to add stream');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: string, action: 'pause' | 'resume' | 'stop' | 'delete') => {
    setBusyId(id);
    setActionError(null);
    try {
      if (action === 'delete') {
        await api.delete(`/streams/${id}`);
      } else {
        await api.patch(`/streams/${id}/${action}`);
      }
      setConfirmDeleteId(null);
      await fetchStreams();
    } catch (err: any) {
      setActionError({ id, message: err.response?.data?.detail || `Failed to ${action} stream` });
    } finally {
      setBusyId(null);
    }
  };

  const toggleForm = () => {
    if (formOpen) resetForm();
    setFormOpen(open => !open);
  };

  const cameraName = (id: string) => cameras.find(c => c.camera_id === id)?.name ?? id;
  const liveCount = streams.filter(s => s.status === 'running').length;
  const pausedCount = streams.filter(s => s.status === 'paused').length;

  const summary = streams.length === 0
    ? 'Connect a camera feed to detect people in real time.'
    : [
        `${liveCount} live`,
        pausedCount > 0 ? `${pausedCount} paused` : null,
        `${streams.length} total`,
      ].filter(Boolean).join(' · ');

  return (
    <div className="st">
      <style>{styles}</style>

      <Reveal className="st-header">
        <div>
          <h1 className="st-title">Live Streams</h1>
          <p className="st-subtitle">
            {liveCount > 0 && <span className="st-dot st-dot--live" aria-hidden="true" />}
            {summary}
          </p>
        </div>
        <button
          type="button"
          className={formOpen ? 'st-btn st-btn--secondary' : 'st-btn st-btn--primary'}
          onClick={toggleForm}
          aria-expanded={formOpen}
          aria-controls="st-add-form"
        >
          {!formOpen && <PlusIcon />}
          {formOpen ? 'Cancel' : 'Add stream'}
        </button>
      </Reveal>

      {formOpen && (
        <form id="st-add-form" className="st-form" onSubmit={handleAdd} noValidate>
          <h2 className="st-form-title">New stream</h2>

          {isAdmin && (
            <label className="st-field">
              <span className="st-label">Shop</span>
              <select
                className="st-input"
                value={shopId}
                onChange={e => {
                  setShopId(e.target.value ? Number(e.target.value) : '');
                  setCameraId('');
                }}
              >
                <option value="">Select a shop</option>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {shopError && <span className="st-field-error">{shopError}</span>}
            </label>
          )}

          <div className="st-row">
            <label className="st-field">
              <span className="st-label">Name</span>
              <input
                className="st-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Front door"
                autoFocus
              />
            </label>
            <label className="st-field">
              <span className="st-label">Camera</span>
              <select
                className="st-input"
                value={cameraId}
                onChange={e => setCameraId(e.target.value)}
                disabled={cameras.length === 0}
              >
                <option value="">Select a camera</option>
                {cameras.map(camera => (
                  <option key={camera.camera_id} value={camera.camera_id}>
                    {camera.name} ({camera.camera_id})
                  </option>
                ))}
              </select>
              {cameraError && <span className="st-field-error">{cameraError}</span>}
            </label>
          </div>

          {!cameraError && cameras.length === 0 && (
            <p className="st-note">
              {isAdmin && !shopId
                ? 'Choose a shop to see its cameras.'
                : <>No cameras registered for this shop yet. Add one on the <Link className="st-link" to="/cameras">Cameras page</Link>.</>}
            </p>
          )}

          <label className="st-field">
            <span className="st-label">Stream URL</span>
            <input
              className="st-input st-input--mono"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="rtsp://host/stream"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="st-hint">RTSP, webcam://0, or a YouTube Live link</span>
          </label>

          {error && <p className="st-error" role="alert">{error}</p>}

          <div className="st-form-actions">
            <button type="submit" disabled={loading} className="st-btn st-btn--primary">
              {loading && <span className="st-spinner" aria-hidden="true" />}
              {loading ? 'Adding…' : 'Add stream'}
            </button>
          </div>
        </form>
      )}

      <Reveal delay={100}>
        {streams.length === 0 ? (
          !formOpen && (
            <div className="st-empty">
              <span className="st-empty-icon"><SourceIcon kind="rtsp" /></span>
              <p className="st-empty-title">No streams yet</p>
              <p className="st-empty-text">Add an RTSP camera, webcam, or YouTube Live feed to start watching.</p>
              <button type="button" className="st-btn st-btn--primary" onClick={() => setFormOpen(true)}>
                <PlusIcon /> Add your first stream
              </button>
            </div>
          )
        ) : (
          <ul className="st-list" aria-label="Streams">
            {streams.map((s, index) => {
              const tone = statusTone(s.status);
              const source = sourceOf(s.url);
              const masked = maskUrl(s.url);
              const busy = busyId === s.stream_id;
              const confirming = confirmDeleteId === s.stream_id;
              const when = s.status === 'stopped'
                ? (s.stopped_at ? `Stopped ${timeAgo(s.stopped_at)}` : null)
                : (s.started_at ? `Started ${timeAgo(s.started_at)}` : null);

              return (
                <li key={s.stream_id} className="st-item" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
                  <div className="st-item-row">
                    <span className={`st-tile st-tile--${tone}`}><SourceIcon kind={source.kind} /></span>

                    <div className="st-main">
                      <div className="st-name-line">
                        <span className="st-name">{s.name}</span>
                        <span className={`st-status st-status--${tone}`}>
                          <span className={`st-dot st-dot--${tone}`} aria-hidden="true" />
                          {statusLabel(s.status)}
                        </span>
                      </div>
                      <p className="st-url" title={masked}>
                        <span className="st-source">{source.label}</span>{masked}
                      </p>
                      <p className="st-meta">
                        {cameraName(s.camera_id)}
                        <span className="st-sep">·</span>
                        {s.persons_found.toLocaleString()} {s.persons_found === 1 ? 'person' : 'people'}
                        <span className="st-sep">·</span>
                        {s.sightings_added.toLocaleString()} {s.sightings_added === 1 ? 'sighting' : 'sightings'}
                        {when && <><span className="st-sep">·</span>{when}</>}
                      </p>
                    </div>

                    <div className="st-actions">
                      {confirming ? (
                        <>
                          <span className="st-confirm-text">Delete this stream?</span>
                          <button type="button" className="st-pill" disabled={busy}
                            onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                          <button type="button" className="st-pill st-pill--danger-solid" disabled={busy}
                            onClick={() => handleAction(s.stream_id, 'delete')}>Delete</button>
                        </>
                      ) : (
                        <>
                          {s.status === 'running' && (
                            <button type="button" className="st-pill" disabled={busy}
                              onClick={() => handleAction(s.stream_id, 'pause')}>Pause</button>
                          )}
                          {s.status === 'paused' && (
                            <button type="button" className="st-pill" disabled={busy}
                              onClick={() => handleAction(s.stream_id, 'resume')}>Resume</button>
                          )}
                          {s.status !== 'stopped' && (
                            <button type="button" className="st-pill" disabled={busy}
                              onClick={() => handleAction(s.stream_id, 'stop')}>Stop</button>
                          )}
                          <button type="button" className="st-pill st-pill--danger" disabled={busy}
                            onClick={() => { setConfirmDeleteId(s.stream_id); setActionError(null); }}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>

                  {actionError?.id === s.stream_id && (
                    <p className="st-error st-item-error" role="alert">{actionError.message}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Reveal>
    </div>
  );
}

const styles = `
.st {
  --st-text: #1d1d1f;
  --st-muted: #6e6e73;
  --st-faint: #86868b;
  --st-line: rgba(0, 0, 0, 0.08);
  --st-soft: rgba(0, 0, 0, 0.04);
  --st-softer: rgba(0, 0, 0, 0.07);
  --st-accent: #0071e3;
  --st-accent-hover: #0077ed;
  --st-green: #30d158;
  --st-orange: #ff9f0a;
  --st-red: #e30000;
  --st-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  max-width: 920px;
  margin: 0 auto;
  padding: 56px 24px 112px;
  color: var(--st-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Header */
.st-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px 24px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--st-line);
}
.st-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}
.st-subtitle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 0;
  font-size: 17px;
  color: var(--st-muted);
  font-variant-numeric: tabular-nums;
}

/* Buttons */
.st-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: 980px;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s var(--st-ease), transform 0.2s var(--st-ease), color 0.2s var(--st-ease);
}
.st-btn:active:not(:disabled) { transform: scale(0.97); }
.st-btn:disabled { opacity: 0.55; cursor: default; }
.st-btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.3); }
.st-btn--primary { background: var(--st-accent); color: #fff; }
.st-btn--primary:hover:not(:disabled) { background: var(--st-accent-hover); }
.st-btn--secondary { background: var(--st-soft); color: var(--st-text); }
.st-btn--secondary:hover { background: var(--st-softer); }

.st-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: st-spin 0.8s linear infinite;
}
@keyframes st-spin { to { transform: rotate(360deg); } }

/* Form */
.st-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 36px 0 44px;
  border-bottom: 1px solid var(--st-line);
  animation: st-drop 0.45s var(--st-ease);
}
@keyframes st-drop { from { opacity: 0; transform: translateY(-10px); } }
.st-form-title { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
.st-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.st-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.st-label { font-size: 14px; font-weight: 500; color: var(--st-muted); }
.st-input {
  width: 100%;
  box-sizing: border-box;
  height: 48px;
  padding: 0 14px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 12px;
  background: #fff;
  color: var(--st-text);
  font: inherit;
  font-size: 17px;
  transition: border-color 0.2s var(--st-ease), box-shadow 0.2s var(--st-ease);
}
.st-input::placeholder { color: #aeaeb2; }
.st-input--mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 15px; }
select.st-input {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 40px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%236e6e73' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
}
.st-input:hover:not(:disabled) { border-color: rgba(0, 0, 0, 0.28); }
.st-input:focus { outline: none; border-color: var(--st-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }
.st-input:disabled { color: var(--st-faint); background-color: rgba(0, 0, 0, 0.02); cursor: not-allowed; }
.st-hint { font-size: 13px; color: var(--st-faint); }
.st-field-error { font-size: 14px; color: var(--st-red); }
.st-note { margin: -6px 0 0; font-size: 15px; color: var(--st-muted); line-height: 1.5; }
.st-error { margin: 0; font-size: 15px; color: var(--st-red); line-height: 1.5; }
.st-link { color: var(--st-accent); text-decoration: none; }
.st-link:hover { text-decoration: underline; }
.st-form-actions { padding-top: 4px; }

/* Status dots */
.st-dot { position: relative; display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.st-dot--live { background: var(--st-green); }
.st-dot--paused, .st-dot--pending { background: var(--st-orange); }
.st-dot--stopped { background: #c7c7cc; }
.st-dot--failed { background: var(--st-red); }
.st-dot--live::after, .st-dot--pending::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: st-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes st-ping { 75%, 100% { transform: scale(2.6); opacity: 0; } }

/* List */
.st-list { list-style: none; margin: 0; padding: 0; }
.st-item {
  border-bottom: 1px solid var(--st-line);
  animation: st-rise 0.5s var(--st-ease) both;
}
@keyframes st-rise { from { opacity: 0; transform: translateY(8px); } }
.st-item-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 22px 0;
}
.st-tile {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--st-soft);
  color: var(--st-muted);
  flex-shrink: 0;
  transition: background 0.3s var(--st-ease), color 0.3s var(--st-ease);
}
.st-tile--live { background: rgba(48, 209, 88, 0.12); color: #1f9e45; }
.st-tile--failed { background: rgba(227, 0, 0, 0.08); color: var(--st-red); }

.st-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.st-name-line { display: flex; align-items: center; gap: 12px; min-width: 0; }
.st-name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--st-muted);
  white-space: nowrap;
}
.st-status--live { color: #1f9e45; }
.st-status--failed { color: var(--st-red); }
.st-url {
  margin: 0;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  color: var(--st-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-source {
  margin-right: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--st-muted);
}
.st-meta { margin: 0; font-size: 14px; color: var(--st-muted); font-variant-numeric: tabular-nums; }
.st-sep { margin: 0 7px; color: #c7c7cc; }

.st-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.st-pill {
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 980px;
  background: var(--st-soft);
  color: var(--st-text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s var(--st-ease), color 0.2s var(--st-ease), transform 0.2s var(--st-ease);
}
.st-pill:hover:not(:disabled) { background: var(--st-softer); }
.st-pill:active:not(:disabled) { transform: scale(0.96); }
.st-pill:disabled { opacity: 0.5; cursor: default; }
.st-pill:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.35); }
.st-pill--danger { background: transparent; color: var(--st-red); }
.st-pill--danger:hover:not(:disabled) { background: rgba(227, 0, 0, 0.07); }
.st-pill--danger-solid { background: var(--st-red); color: #fff; }
.st-pill--danger-solid:hover:not(:disabled) { background: #c80000; }
.st-confirm-text { font-size: 14px; color: var(--st-muted); margin-right: 4px; animation: st-fade 0.25s var(--st-ease); }
@keyframes st-fade { from { opacity: 0; } }
.st-item-error { padding: 0 0 18px 60px; font-size: 14px; }

/* Empty state */
.st-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 96px 24px;
}
.st-empty-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--st-soft);
  color: var(--st-muted);
  margin-bottom: 18px;
}
.st-empty-title { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
.st-empty-text { margin: 8px 0 24px; max-width: 360px; font-size: 17px; color: var(--st-muted); line-height: 1.45; }

/* Responsive */
@media (max-width: 720px) {
  .st { padding: 40px 16px 80px; }
  .st-row { grid-template-columns: 1fr; }
  .st-item-row { flex-wrap: wrap; gap: 12px 14px; }
  .st-main { flex-basis: calc(100% - 58px); }
  .st-actions { width: 100%; padding-left: 58px; flex-wrap: wrap; }
  .st-item-error { padding-left: 58px; }
}

@media (prefers-reduced-motion: reduce) {
  .st *, .st *::after { animation: none !important; transition: none !important; }
}
`;