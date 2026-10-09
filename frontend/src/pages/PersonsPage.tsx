import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../api/client';
import { cropUrl } from '../api/utils';
import { Person } from '../types';
import AuthenticatedImage from '../components/AuthenticatedImage';
import Reveal from '../components/Reveal';

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

const PersonIcon = ({ size = 28 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8.5" r="3.75" />
    <path d="M4.5 20c.9-3.6 3.9-5.75 7.5-5.75s6.6 2.15 7.5 5.75" />
  </svg>
);

const PAGE_SIZE = 12;

export default function PersonsPage() {
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get('job_id');
  const [persons, setPersons] = useState<Person[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const params: any = { page, limit: PAGE_SIZE };
    if (jobId) params.job_id = jobId;
    setLoading(true);
    api.get('/persons', { params })
      .then(r => {
        if (cancelled) return;
        setPersons(r.data.persons || []);
        setTotalPages(r.data.total_pages || 0);
        setTotal(r.data.total || 0);
        setError('');
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.response?.data?.detail || 'Unable to load people');
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); setLoaded(true); }
      });
    return () => { cancelled = true; };
  }, [page, jobId]);

  const goToPage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const title = jobId ? 'People in this video' : 'People';
  const subtitle = !loaded
    ? 'Loading…'
    : total === 0
      ? (jobId ? 'No one has been identified in this video yet.' : 'People detected in your footage will appear here.')
      : `${total.toLocaleString()} ${total === 1 ? 'person' : 'people'} identified`;

  return (
    <div className="pp">
      <style>{styles}</style>

      <Reveal className="pp-header">
        {jobId && (
          <Link to="/persons" className="pp-back">
            <span aria-hidden="true">‹</span> All people
          </Link>
        )}
        <h1 className="pp-title">{title}</h1>
        <p className="pp-subtitle">{subtitle}</p>
      </Reveal>

      {error && <p className="pp-error" role="alert">{error}</p>}

      {!loaded ? (
        <div className="pp-grid" aria-hidden="true">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i} className="pp-skeleton" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="pp-skeleton-media" />
              <div className="pp-skeleton-line" />
              <div className="pp-skeleton-line pp-skeleton-line--short" />
            </div>
          ))}
        </div>
      ) : persons.length === 0 ? (
        !error && (
          <Reveal className="pp-empty">
            <span className="pp-empty-icon"><PersonIcon /></span>
            <p className="pp-empty-title">No people yet</p>
            {!jobId && (
              <>
                <p className="pp-empty-text">Upload footage or connect a live stream to start identifying people.</p>
                <Link to="/ingest" className="pp-btn">Upload a video</Link>
              </>
            )}
          </Reveal>
        )
      ) : (
        <ul className={`pp-grid${loading ? ' is-loading' : ''}`} aria-busy={loading} aria-label="People">
          {persons.map((p, index) => {
            const name = p.label || `Person #${p.id}`;
            const seen = timeAgo(p.last_seen);
            return (
              <li key={p.id} className="pp-item" style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}>
                <Link to={`/persons/${p.id}${jobId ? `?job_id=${jobId}` : ''}`} className="pp-card">
                  <div className="pp-media">
                    {p.latest_crop_url ? (
                      <AuthenticatedImage
                        src={cropUrl(p.latest_crop_url)}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <span className="pp-media-empty"><PersonIcon size={34} /></span>
                    )}
                  </div>
                  <div className="pp-info">
                    <span className={`pp-name${p.label ? '' : ' is-unnamed'}`}>{name}</span>
                    <span className="pp-meta">
                      {p.sighting_count.toLocaleString()} {p.sighting_count === 1 ? 'sighting' : 'sightings'}
                      {seen && <><span className="pp-sep">·</span>{seen}</>}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="pp-pager" aria-label="Pages">
          <button type="button" onClick={() => goToPage(Math.max(1, page - 1))} disabled={page === 1 || loading}>
            ‹ Previous
          </button>
          <span className="pp-page-info">Page {page} of {totalPages}</span>
          <button type="button" onClick={() => goToPage(Math.min(totalPages, page + 1))} disabled={page === totalPages || loading}>
            Next ›
          </button>
        </nav>
      )}
    </div>
  );
}

const styles = `
.pp {
  --pp-text: #1d1d1f;
  --pp-muted: #6e6e73;
  --pp-faint: #86868b;
  --pp-line: rgba(0, 0, 0, 0.08);
  --pp-soft: rgba(0, 0, 0, 0.04);
  --pp-accent: #0071e3;
  --pp-accent-hover: #0077ed;
  --pp-red: #e30000;
  --pp-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  max-width: 1120px;
  margin: 0 auto;
  padding: 56px 24px 112px;
  color: var(--pp-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Header */
.pp-header {
  padding-bottom: 28px;
  margin-bottom: 36px;
  border-bottom: 1px solid var(--pp-line);
}
.pp-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
  font-size: 15px;
  color: var(--pp-accent);
  text-decoration: none;
}
.pp-back span { font-size: 22px; line-height: 1; transform: translateY(-1px); transition: transform 0.25s var(--pp-ease); }
.pp-back:hover span { transform: translate(-3px, -1px); }
.pp-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}
.pp-subtitle { margin: 8px 0 0; font-size: 17px; color: var(--pp-muted); font-variant-numeric: tabular-nums; }
.pp-error { margin: 0 0 24px; font-size: 15px; color: var(--pp-red); }

/* Grid */
.pp-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 36px 22px;
  transition: opacity 0.3s var(--pp-ease);
}
.pp-grid.is-loading { opacity: 0.45; pointer-events: none; }

.pp-item { animation: pp-rise 0.55s var(--pp-ease) both; }
@keyframes pp-rise { from { opacity: 0; transform: translateY(12px); } }

.pp-card { display: block; color: inherit; text-decoration: none; border-radius: 18px; }
.pp-card:focus-visible { outline: none; }
.pp-card:focus-visible .pp-media { box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--pp-accent); }

.pp-media {
  position: relative;
  aspect-ratio: 4 / 5;
  border-radius: 18px;
  overflow: hidden;
  background: var(--pp-soft);
  transition: box-shadow 0.4s var(--pp-ease), transform 0.4s var(--pp-ease);
}
.pp-media img { transition: transform 0.6s var(--pp-ease); }
.pp-card:hover .pp-media {
  transform: translateY(-4px);
  box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.25);
}
.pp-card:hover .pp-media img { transform: scale(1.05); }
.pp-card:active .pp-media { transform: translateY(-1px) scale(0.99); }
.pp-media-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #c7c7cc;
}

.pp-info { display: flex; flex-direction: column; gap: 3px; padding: 14px 4px 0; min-width: 0; }
.pp-name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.25s var(--pp-ease);
}
.pp-name.is-unnamed { color: var(--pp-muted); font-weight: 500; }
.pp-card:hover .pp-name { color: var(--pp-accent); }
.pp-meta { font-size: 14px; color: var(--pp-faint); font-variant-numeric: tabular-nums; }
.pp-sep { margin: 0 6px; color: #c7c7cc; }

/* Skeletons */
.pp-skeleton { animation: pp-fade 0.4s var(--pp-ease) both; }
@keyframes pp-fade { from { opacity: 0; } }
.pp-skeleton-media, .pp-skeleton-line {
  background: linear-gradient(90deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 100%);
  background-size: 200% 100%;
  animation: pp-shimmer 1.4s ease-in-out infinite;
}
.pp-skeleton-media { aspect-ratio: 4 / 5; border-radius: 18px; }
.pp-skeleton-line { height: 14px; width: 70%; margin: 16px 4px 0; border-radius: 7px; }
.pp-skeleton-line--short { width: 45%; margin-top: 8px; height: 12px; }
@keyframes pp-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }

/* Empty */
.pp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 80px 24px;
}
.pp-empty-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--pp-soft);
  color: var(--pp-muted);
  margin-bottom: 18px;
}
.pp-empty-title { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
.pp-empty-text { margin: 8px 0 24px; max-width: 360px; font-size: 17px; color: var(--pp-muted); line-height: 1.45; }
.pp-btn {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 22px;
  border-radius: 980px;
  background: var(--pp-accent);
  color: #fff;
  font-size: 15px;
  text-decoration: none;
  transition: background 0.2s var(--pp-ease), transform 0.2s var(--pp-ease);
}
.pp-btn:hover { background: var(--pp-accent-hover); }
.pp-btn:active { transform: scale(0.97); }

/* Pager */
.pp-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 28px;
  margin-top: 64px;
  padding-top: 28px;
  border-top: 1px solid var(--pp-line);
}
.pp-pager button {
  padding: 6px 4px;
  border: none;
  background: none;
  color: var(--pp-accent);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}
.pp-pager button:disabled { color: rgba(0, 0, 0, 0.25); cursor: default; }
.pp-pager button:not(:disabled):hover { text-decoration: underline; }
.pp-page-info { font-size: 14px; color: var(--pp-faint); font-variant-numeric: tabular-nums; }

/* Responsive */
@media (max-width: 720px) {
  .pp { padding: 40px 16px 80px; }
  .pp-grid { grid-template-columns: repeat(2, 1fr); gap: 28px 14px; }
  .pp-media, .pp-skeleton-media { border-radius: 14px; }
  .pp-name { font-size: 15px; }
  .pp-meta { font-size: 13px; }
  .pp-pager { gap: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .pp *, .pp *::after { animation: none !important; transition: none !important; }
}
`;