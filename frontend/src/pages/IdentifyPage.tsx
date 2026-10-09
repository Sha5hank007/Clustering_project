import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { cropUrl } from '../api/utils';
import { IdentifyResult } from '../types';
import AuthenticatedImage from '../components/AuthenticatedImage';
import Reveal from '../components/Reveal';

interface Shop { id: number; name: string; }
interface Camera { camera_id: string; name?: string; }

function timeAgo(value: string | null | undefined) {
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 28;

const PhotoIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="9" r="3.5" />
    <path d="M5.5 19c1-3 3.6-4.75 6.5-4.75S17.5 16 18.5 19" />
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />
  </svg>
);

export default function IdentifyPage() {
  const { isAdmin } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [shops, setShops] = useState<Shop[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [shopId, setShopId] = useState<number | ''>('');
  const [cameraId, setCameraId] = useState('');

  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAdmin) {
      api.get('/admin/shops')
        .then(r => setShops(Array.isArray(r.data) ? r.data : r.data.shops || []))
        .catch(() => {});
    }
  }, [isAdmin]);

  // Registered cameras for the camera filter (admins pick a shop first)
  useEffect(() => {
    setCameraId('');
    if (isAdmin && !shopId) {
      setCameras([]);
      return;
    }
    api.get('/cameras', { params: { include_inactive: true, ...(isAdmin ? { shop_id: shopId } : {}) } })
      .then(r => setCameras(Array.isArray(r.data) ? r.data : r.data.cameras || []))
      .catch(() => setCameras([]));
  }, [isAdmin, shopId]);

  // Free the preview URL when it changes or the page unmounts
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const handleFile = (f: File | null) => {
    setResult(null);
    setError('');
    if (f && !f.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
    if (!f) {
      const input = document.getElementById('id-file') as HTMLInputElement | null;
      if (input) input.value = '';
    }
  };

  const handleSearch = async () => {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const form = new FormData();
      form.append('image', file);
      if (isAdmin && shopId) form.append('shop_id', String(shopId));
      if (cameraId) form.append('camera_id', cameraId);
      const res = await api.post('/identify', form);
      setResult(res.data);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Identification failed');
    } finally {
      setLoading(false);
    }
  };

  const shopName = shops.find(sh => sh.id === shopId)?.name;
  const cameraLabel = cameras.find(c => c.camera_id === cameraId)?.name || cameraId;
  const scope = [
    isAdmin ? (shopName ?? 'all shops') : null,
    cameraId ? cameraLabel : 'all cameras',
  ].filter(Boolean).join(', ');

  // Group sightings by day, keeping the server's order
  const groups: { label: string; items: IdentifyResult['sightings'] }[] = [];
  if (result) {
    const byDay = new Map<string, IdentifyResult['sightings']>();
    for (const si of result.sightings) {
      const key = si.seen_at ? new Date(si.seen_at).toDateString() : 'unknown';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(si);
    }
    byDay.forEach((items, key) => {
      groups.push({ label: key === 'unknown' ? 'Unknown date' : dayLabel(new Date(key)), items });
    });
  }

  const similarity = result ? Math.max(0, Math.min(1, result.similarity)) : 0;

  return (
    <div className="id">
      <style>{styles}</style>

      <Reveal className="id-header">
        <h1 className="id-title">Identify</h1>
        <p className="id-subtitle">Find every sighting of a person from a single photo.</p>
      </Reveal>

      <Reveal delay={80}>
        <section className="id-search" aria-label="Search">
          <div className="id-photo">
            <label
              htmlFor="id-file"
              className={`id-drop${dragging ? ' is-dragging' : ''}${preview ? ' has-image' : ''}${loading ? ' is-scanning' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) handleFile(dropped);
              }}
            >
              <input
                id="id-file"
                type="file"
                accept="image/*"
                className="id-file-input"
                disabled={loading}
                onChange={e => handleFile(e.target.files?.[0] || null)}
              />
              {preview ? (
                <>
                  <img src={preview} alt="Selected photo" className="id-preview" />
                  {loading && <span className="id-scan" aria-hidden="true" />}
                </>
              ) : (
                <span className="id-drop-empty">
                  <span className="id-drop-icon"><PhotoIcon /></span>
                  <span className="id-drop-title">Add a photo</span>
                  <span className="id-drop-hint">Drop an image or <span className="id-accent">browse</span></span>
                </span>
              )}
            </label>
            {file && (
              <div className="id-photo-bar">
                <span className="id-photo-name" title={file.name}>{file.name}</span>
                <button type="button" className="id-text-btn" onClick={() => handleFile(null)} disabled={loading}>
                  Remove
                </button>
              </div>
            )}
          </div>

          <div className="id-controls">
            {isAdmin && shops.length > 0 && (
              <label className="id-field">
                <span className="id-label">Shop</span>
                <select
                  className="id-input"
                  value={shopId}
                  onChange={e => setShopId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">All shops</option>
                  {shops.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                </select>
              </label>
            )}
            <label className="id-field">
              <span className="id-label">Camera</span>
              <select
                className="id-input"
                value={cameraId}
                onChange={e => setCameraId(e.target.value)}
                disabled={cameras.length === 0}
              >
                <option value="">All cameras</option>
                {cameras.map(c => (
                  <option key={c.camera_id} value={c.camera_id}>{c.name ? `${c.name} (${c.camera_id})` : c.camera_id}</option>
                ))}
              </select>
              {isAdmin && !shopId && <span className="id-hint">Choose a shop to filter by camera.</span>}
            </label>

            <div className="id-action">
              <button type="button" className="id-btn" onClick={handleSearch} disabled={!file || loading}>
                {loading ? <span className="id-spinner" aria-hidden="true" /> : <SearchIcon />}
                {loading ? 'Searching…' : 'Search'}
              </button>
              <span className="id-scope">
                {file ? <>Searching {scope}</> : 'Add a photo to begin'}
              </span>
            </div>

            {error && <p className="id-error" role="alert">{error}</p>}
          </div>
        </section>
      </Reveal>

      {result && (
        <div className="id-result" ref={resultRef}>
          <section className="id-match" aria-label="Best match">
            <div className="id-ring-wrap">
              <svg viewBox="0 0 64 64" className="id-ring" aria-hidden="true">
                <circle cx="32" cy="32" r="28" className="id-ring-track" />
                <circle
                  cx="32" cy="32" r="28"
                  className="id-ring-value"
                  style={{
                    strokeDasharray: RING_CIRCUMFERENCE,
                    strokeDashoffset: RING_CIRCUMFERENCE * (1 - similarity),
                  }}
                />
              </svg>
              <span className="id-ring-text">
                <span className="id-ring-number">{(similarity * 100).toFixed(1)}<small>%</small></span>
                <span className="id-ring-caption">match</span>
              </span>
            </div>

            <div className="id-match-text">
              <p className="id-eyebrow">Best match</p>
              <h2 className="id-match-name">{result.label || `Person #${result.person_id}`}</h2>
              <Link to={`/persons/${result.person_id}`} className="id-link">View profile <span aria-hidden="true">›</span></Link>
            </div>
          </section>

          <dl className="id-stats">
            <div>
              <dt>Sightings</dt>
              <dd>{result.total_sightings.toLocaleString()}</dd>
            </div>
            <div>
              <dt>First seen</dt>
              <dd>{timeAgo(result.first_seen) ?? '—'}</dd>
              {result.first_seen && <dd className="id-faint">{formatDateTime(result.first_seen)}</dd>}
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{timeAgo(result.last_seen) ?? '—'}</dd>
              {result.last_seen && <dd className="id-faint">{formatDateTime(result.last_seen)}</dd>}
            </div>
          </dl>

          <section className="id-history" aria-labelledby="id-history-title">
            <h2 className="id-section-title" id="id-history-title">Sighting history</h2>
            {groups.length === 0 ? (
              <p className="id-note">No sightings recorded.</p>
            ) : groups.map((group, gi) => (
              <div key={group.label + gi} className="id-day">
                <h3 className="id-day-label">
                  {group.label}
                  <span className="id-faint">{group.items.length}</span>
                </h3>
                <ul className="id-grid">
                  {group.items.map((si, index) => (
                    <li key={si.id} className="id-shot" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}>
                      <div className="id-shot-media">
                        {si.crop_url ? (
                          <AuthenticatedImage
                            src={cropUrl(si.crop_url)}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        ) : (
                          <span className="id-shot-empty">No image</span>
                        )}
                      </div>
                      <span className="id-shot-time">
                        {si.seen_at
                          ? new Date(si.seen_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                          : '—'}
                      </span>
                      <span className="id-shot-camera">{si.camera_id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

const styles = `
.id {
  --id-text: #1d1d1f;
  --id-muted: #6e6e73;
  --id-faint: #86868b;
  --id-line: rgba(0, 0, 0, 0.08);
  --id-soft: rgba(0, 0, 0, 0.04);
  --id-accent: #0071e3;
  --id-accent-hover: #0077ed;
  --id-red: #e30000;
  --id-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  max-width: 1000px;
  margin: 0 auto;
  padding: 56px 24px 112px;
  color: var(--id-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Header */
.id-header { padding-bottom: 28px; margin-bottom: 44px; border-bottom: 1px solid var(--id-line); }
.id-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}
.id-subtitle { margin: 8px 0 0; font-size: 17px; color: var(--id-muted); }

/* Search area */
.id-search {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 56px;
  align-items: start;
}

.id-drop {
  position: relative;
  display: block;
  aspect-ratio: 1;
  border-radius: 28px;
  border: 1.5px dashed rgba(0, 0, 0, 0.16);
  background: rgba(0, 0, 0, 0.015);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.3s var(--id-ease), background 0.3s var(--id-ease), transform 0.4s var(--id-ease), box-shadow 0.4s var(--id-ease);
}
.id-drop:hover, .id-drop.is-dragging { border-color: var(--id-accent); background: rgba(0, 113, 227, 0.04); }
.id-drop.is-dragging { transform: scale(1.02); }
.id-drop:focus-within { border-color: var(--id-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }
.id-drop.has-image {
  border: none;
  background: #000;
  box-shadow: 0 24px 48px -20px rgba(0, 0, 0, 0.35);
}
.id-drop.has-image:hover { transform: translateY(-2px); }
.id-drop.is-scanning { cursor: progress; pointer-events: none; }
.id-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.id-drop-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
}
.id-drop-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: rgba(0, 113, 227, 0.08);
  color: var(--id-accent);
}
.id-drop-title { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
.id-drop-hint { font-size: 15px; color: var(--id-muted); }
.id-accent { color: var(--id-accent); }

.id-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  animation: id-pop 0.5s var(--id-ease);
}
@keyframes id-pop { from { opacity: 0; transform: scale(1.04); } }
.id-drop.is-scanning .id-preview { filter: saturate(0.6) brightness(0.85); transition: filter 0.4s var(--id-ease); }

.id-scan {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 38%;
  background: linear-gradient(180deg, rgba(41, 151, 255, 0) 0%, rgba(41, 151, 255, 0.28) 85%, rgba(140, 200, 255, 0.95) 100%);
  border-bottom: 2px solid rgba(180, 220, 255, 0.95);
  animation: id-scan 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate;
}
@keyframes id-scan {
  from { transform: translateY(-100%); }
  to { transform: translateY(263%); }
}

.id-photo-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 0 4px;
}
.id-photo-name {
  font-size: 14px;
  color: var(--id-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.id-text-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--id-accent);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
}
.id-text-btn:hover:not(:disabled) { text-decoration: underline; }
.id-text-btn:disabled { color: var(--id-faint); cursor: default; }

/* Controls */
.id-controls { display: flex; flex-direction: column; gap: 22px; padding-top: 4px; }
.id-field { display: flex; flex-direction: column; gap: 8px; }
.id-label { font-size: 14px; font-weight: 500; color: var(--id-muted); }
.id-hint { font-size: 13px; color: var(--id-faint); }
.id-input {
  width: 100%;
  box-sizing: border-box;
  height: 48px;
  padding: 0 40px 0 14px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 12px;
  background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%236e6e73' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 16px center;
  appearance: none;
  -webkit-appearance: none;
  color: var(--id-text);
  font: inherit;
  font-size: 17px;
  cursor: pointer;
  transition: border-color 0.2s var(--id-ease), box-shadow 0.2s var(--id-ease);
}
.id-input:hover:not(:disabled) { border-color: rgba(0, 0, 0, 0.28); }
.id-input:focus { outline: none; border-color: var(--id-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }
.id-input:disabled { color: var(--id-faint); background-color: rgba(0, 0, 0, 0.02); cursor: not-allowed; }

.id-action { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding-top: 6px; }
.id-btn {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  height: 48px;
  padding: 0 30px;
  border: none;
  border-radius: 980px;
  background: var(--id-accent);
  color: #fff;
  font: inherit;
  font-size: 17px;
  cursor: pointer;
  transition: background 0.2s var(--id-ease), transform 0.2s var(--id-ease), opacity 0.2s var(--id-ease);
}
.id-btn:hover:not(:disabled) { background: var(--id-accent-hover); }
.id-btn:active:not(:disabled) { transform: scale(0.97); }
.id-btn:disabled { opacity: 0.4; cursor: default; }
.id-btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.3); }
.id-spinner {
  width: 15px; height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: id-spin 0.8s linear infinite;
}
@keyframes id-spin { to { transform: rotate(360deg); } }
.id-scope { font-size: 14px; color: var(--id-faint); }
.id-error { margin: 0; font-size: 15px; color: var(--id-red); line-height: 1.5; animation: id-fade 0.3s var(--id-ease); }
@keyframes id-fade { from { opacity: 0; } }

/* Result */
.id-result {
  margin-top: 96px;
  padding-top: 56px;
  border-top: 1px solid var(--id-line);
  scroll-margin-top: 80px;
  animation: id-rise 0.7s var(--id-ease) both;
}
@keyframes id-rise { from { opacity: 0; transform: translateY(24px); } }

.id-match { display: flex; align-items: center; gap: 36px; }
.id-ring-wrap { position: relative; width: 148px; height: 148px; flex-shrink: 0; }
.id-ring { width: 100%; height: 100%; transform: rotate(-90deg); }
.id-ring-track { fill: none; stroke: rgba(0, 0, 0, 0.06); stroke-width: 5; }
.id-ring-value {
  fill: none;
  stroke: var(--id-accent);
  stroke-width: 5;
  stroke-linecap: round;
  animation: id-ring 1.3s cubic-bezier(0.2, 0.8, 0.2, 1) 0.2s both;
}
@keyframes id-ring { from { stroke-dashoffset: ${RING_CIRCUMFERENCE}; } }
.id-ring-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.id-ring-number {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.id-ring-number small { font-size: 16px; font-weight: 600; margin-left: 1px; color: var(--id-muted); }
.id-ring-caption { font-size: 12px; color: var(--id-faint); margin-top: 2px; }

.id-match-text { min-width: 0; }
.id-eyebrow { margin: 0 0 6px; font-size: 14px; font-weight: 500; color: var(--id-muted); }
.id-match-name {
  margin: 0 0 12px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 5vw, 48px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  overflow-wrap: anywhere;
}
.id-link { font-size: 17px; color: var(--id-accent); text-decoration: none; }
.id-link span { display: inline-block; transition: transform 0.25s var(--id-ease); }
.id-link:hover span { transform: translateX(3px); }

.id-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 48px 0 0;
  border-top: 1px solid var(--id-line);
  border-bottom: 1px solid var(--id-line);
}
.id-stats > div { padding: 22px 20px 22px 0; }
.id-stats > div + div { border-left: 1px solid var(--id-line); padding-left: 24px; }
.id-stats dt { font-size: 14px; color: var(--id-muted); }
.id-stats dd {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.id-stats dd.id-faint { margin-top: 4px; font-size: 13px; font-weight: 400; letter-spacing: 0; }
.id-faint { color: var(--id-faint); }

/* History */
.id-history { margin-top: 72px; }
.id-section-title { margin: 0 0 8px; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
.id-note { font-size: 17px; color: var(--id-muted); }
.id-day { padding-top: 28px; }
.id-day-label {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 600;
}
.id-day-label .id-faint { font-size: 14px; font-weight: 400; }
.id-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 24px 16px;
}
.id-shot { display: flex; flex-direction: column; min-width: 0; animation: id-rise-sm 0.5s var(--id-ease) both; }
@keyframes id-rise-sm { from { opacity: 0; transform: translateY(10px); } }
.id-shot-media {
  aspect-ratio: 4 / 5;
  border-radius: 14px;
  overflow: hidden;
  background: var(--id-soft);
  display: grid;
  place-items: center;
}
.id-shot-media img { transition: transform 0.5s var(--id-ease); }
.id-shot:hover .id-shot-media img { transform: scale(1.05); }
.id-shot-empty { font-size: 12px; color: var(--id-faint); }
.id-shot-time { margin-top: 10px; font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }
.id-shot-camera {
  font-size: 13px;
  color: var(--id-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Responsive */
@media (max-width: 760px) {
  .id { padding: 40px 16px 80px; }
  .id-search { grid-template-columns: 1fr; gap: 32px; }
  .id-photo { max-width: 340px; width: 100%; margin: 0 auto; }
  .id-result { margin-top: 64px; padding-top: 40px; }
  .id-match { flex-direction: column; align-items: flex-start; gap: 24px; }
  .id-ring-wrap { width: 120px; height: 120px; }
  .id-stats { grid-template-columns: 1fr; }
  .id-stats > div + div { border-left: none; padding-left: 0; border-top: 1px solid var(--id-line); }
  .id-grid { grid-template-columns: repeat(3, 1fr); gap: 18px 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .id *, .id *::after { animation: none !important; transition: none !important; }
}
`;