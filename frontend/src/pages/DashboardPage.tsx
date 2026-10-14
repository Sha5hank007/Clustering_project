import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { cropUrl } from '../api/utils';
import { Stats, IngestJob, Person } from '../types';
import { useAuth } from '../context/AuthContext';
import AuthenticatedImage from '../components/AuthenticatedImage';

/* ------------------------------------------------------------------ */
/* Types, colors, helpers                                              */
/* ------------------------------------------------------------------ */

interface Stream {
  stream_id: string;
  name: string;
  camera_id: string;
  status: string;
  persons_found: number;
  sightings_added: number;
}

const PEOPLE_COUNT = 8;
const BAR_ROWS = 6;

// Identity colors for the summary metrics.
const HUE = {
  blue: '#2a78d6',
  violet: '#6250d6',
  aqua: '#1baf7a',
  orange: '#eb6834',
  green: '#0ca30c',
};
// Status colors. Only used where the color means a state.
const STATUS = {
  good: '#0ca30c',
  info: '#2a78d6',
  warning: '#fab219',
  critical: '#d03b3b',
  neutral: '#c3c2b7',
};

type StreamTone = 'live' | 'pending' | 'paused' | 'failed' | 'stopped';
function streamTone(status: string): StreamTone {
  switch ((status || '').toLowerCase()) {
    case 'running': return 'live';
    case 'paused': return 'paused';
    case 'stopped': return 'stopped';
    case 'error':
    case 'failed': return 'failed';
    default: return 'pending';
  }
}
const STREAM_TONES: StreamTone[] = ['live', 'pending', 'paused', 'failed', 'stopped'];
const STREAM_LABEL: Record<StreamTone, string> = {
  live: 'Live', pending: 'Starting', paused: 'Paused', failed: 'Error', stopped: 'Stopped',
};
const STREAM_COLOR: Record<StreamTone, string> = {
  live: STATUS.good, pending: STATUS.info, paused: STATUS.warning, failed: STATUS.critical, stopped: STATUS.neutral,
};

type JobTone = 'done' | 'active' | 'failed';
function jobTone(status: string): JobTone {
  const s = (status || '').toLowerCase();
  if (['completed', 'complete', 'done', 'finished', 'success', 'succeeded'].includes(s)) return 'done';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed';
  return 'active';
}
const JOB_TONES: JobTone[] = ['done', 'active', 'failed'];
const JOB_LABEL: Record<JobTone, string> = { done: 'Done', active: 'Processing', failed: 'Failed' };
const JOB_COLOR: Record<JobTone, string> = { done: STATUS.good, active: STATUS.info, failed: STATUS.critical };

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

function shortDate(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const fmt = (n: number) => (n || 0).toLocaleString();

function plural(n: number, one: string, many: string) {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const svgProps = {
  viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
};
const Icon = {
  Eye: () => <svg {...svgProps}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  Person: () => <svg {...svgProps}><circle cx="12" cy="8.5" r="3.75" /><path d="M4.5 20c.9-3.6 3.9-5.75 7.5-5.75s6.6 2.15 7.5 5.75" /></svg>,
  Live: () => <svg {...svgProps}><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4" /></svg>,
  Queue: () => <svg {...svgProps}><path d="M4 6h16M4 12h10M4 18h6" /></svg>,
  Camera: () => <svg {...svgProps}><path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" /><rect x="3" y="6" width="12" height="12" rx="2" /></svg>,
  Check: () => <svg {...svgProps}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  Alert: () => <svg {...svgProps}><path d="M12 8v5M12 16.5v.01" /><circle cx="12" cy="12" r="9" /></svg>,
  Pause: () => <svg {...svgProps}><path d="M9 7v10M15 7v10" /></svg>,
  Refresh: () => <svg {...svgProps}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>,
};

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return <span className="ov-chip" style={{ color, background: `${color}1a` }}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';

  const [stats, setStats] = useState<Stats | null>(null);
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [jobs, setJobs] = useState<IngestJob[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasStats = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [st, sr, jb, pp] = await Promise.allSettled([
      api.get('/stats'),
      api.get('/streams'),
      api.get('/ingest/jobs', { params: { page: 1, limit: 10 } }),
      api.get('/persons', { params: { page: 1, limit: PEOPLE_COUNT } }),
    ]);
    if (!mounted.current) return;

    if (st.status === 'fulfilled') {
      hasStats.current = true;
      setStats(st.value.data);
      setError('');
    } else if (!hasStats.current) {
      const err: any = st.reason;
      setError(err?.response?.data?.detail || 'The server did not respond.');
    }
    if (sr.status === 'fulfilled') {
      const d = sr.value.data;
      setStreams(Array.isArray(d) ? d : d.streams || []);
    }
    if (jb.status === 'fulfilled') setJobs(jb.value.data.jobs || []);
    if (pp.status === 'fulfilled') setPeople(pp.value.data.persons || []);
    setUpdatedAt(new Date());
    setRefreshing(false);
  }, []);

  // Load once, and again when the user returns to the tab. No polling.
  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (error) {
    return (
      <div className="ov ov-message" role="alert">
        <style>{styles}</style>
        <p>Couldn't load the dashboard. {error}</p>
        <button type="button" className="ov-button" onClick={load} disabled={refreshing}>Try again</button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="ov" aria-busy="true" aria-label="Loading dashboard">
        <style>{styles}</style>
        <div className="ov-skel" style={{ height: 40, width: 220, marginBottom: 20 }} />
        <div className="ov-skel" style={{ height: 180, marginBottom: 16 }} />
        <div className="ov-grid">
          <div className="ov-skel ov-span-5" style={{ height: 280 }} />
          <div className="ov-skel ov-span-7" style={{ height: 280 }} />
        </div>
      </div>
    );
  }

  /* ---------- aggregates ---------- */

  const streamList = streams ?? [];
  const jobList = jobs ?? [];
  const peopleList = (people ?? []).slice(0, PEOPLE_COUNT);

  const streamCount: Record<StreamTone, number> = { live: 0, pending: 0, paused: 0, failed: 0, stopped: 0 };
  streamList.forEach(s => { streamCount[streamTone(s.status)] += 1; });
  const jobCount: Record<JobTone, number> = { done: 0, active: 0, failed: 0 };
  jobList.forEach(j => { jobCount[jobTone(j.status)] += 1; });
  const activeJobs = jobList.filter(j => jobTone(j.status) === 'active');

  const perPerson = stats.total_persons > 0 ? stats.total_sightings / stats.total_persons : 0;
  const since = shortDate(stats.first_sighting);

  // Sightings by stream
  const byStream = [...streamList].sort((a, b) => (b.sightings_added || 0) - (a.sightings_added || 0));
  const streamSightings = byStream.reduce((sum, s) => sum + (s.sightings_added || 0), 0);
  const maxSightings = Math.max(1, ...byStream.map(s => s.sightings_added || 0));
  const top = byStream[0];
  const topShare = top && streamSightings > 0 ? Math.round(((top.sightings_added || 0) / streamSightings) * 100) : 0;

  // Health banner
  const issues: string[] = [];
  if (streamCount.failed) issues.push(`${plural(streamCount.failed, 'stream', 'streams')} stopped with an error`);
  if (jobCount.failed) issues.push(`${plural(jobCount.failed, 'upload', 'uploads')} failed`);

  let health: { tone: 'alert' | 'ok' | 'idle'; title: string; detail: string; href?: string; action?: string };
  if (issues.length) {
    health = {
      tone: 'alert',
      title: 'Needs attention',
      detail: issues.join(' and '),
      href: streamCount.failed ? '/streams' : '/ingest',
      action: streamCount.failed ? 'Review streams' : 'Review uploads',
    };
  } else if (streamCount.live > 0 || stats.pending_jobs > 0) {
    const parts: string[] = [];
    if (streamCount.live > 0) parts.push(`${plural(streamCount.live, 'stream', 'streams')} live`);
    if (stats.pending_jobs > 0) parts.push(`${plural(stats.pending_jobs, 'video', 'videos')} processing`);
    health = { tone: 'ok', title: 'Everything is running', detail: parts.join(', ') };
  } else {
    health = {
      tone: 'idle',
      title: 'Nothing running',
      detail: 'No live streams or uploads in progress',
      href: '/streams',
      action: 'Start a stream',
    };
  }

  // Donut geometry
  const R = 46;
  const CIRC = 2 * Math.PI * R;
  const donutTones = STREAM_TONES.filter(t => streamCount[t] > 0);
  const gap = donutTones.length > 1 ? 2 : 0;
  let acc = 0;

  return (
    <div className="ov">
      <style>{styles}</style>

      {/* Header */}
      <header className="ov-header">
        <div>
          <h1>Overview</h1>
          <p className="ov-muted">
            {updatedAt
              ? `Updated ${updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : 'Loading'}
          </p>
        </div>
        <button type="button" className="ov-button" onClick={load} disabled={refreshing}>
          <span className={refreshing ? 'ov-spin' : undefined}><Icon.Refresh /></span>
          Refresh
        </button>
      </header>

      {/* Health */}
      <div className={`ov-health ov-health--${health.tone}`} role="status">
        <span className="ov-health-icon">
          {health.tone === 'alert' ? <Icon.Alert /> : health.tone === 'ok' ? <Icon.Check /> : <Icon.Pause />}
        </span>
        <p><strong>{health.title}.</strong> {health.detail}.</p>
        {health.href && <Link to={health.href} className="ov-health-action">{health.action}</Link>}
      </div>

      {/* Summary: one hero number, four supporting numbers */}
      <section className="ov-panel ov-summary" aria-label="Summary">
        <div className="ov-hero">
          <p className="ov-label"><Chip color={HUE.blue}><Icon.Eye /></Chip>Total sightings</p>
          <p className="ov-hero-value">{fmt(stats.total_sightings)}</p>
          <p className="ov-hero-sub">
            {stats.last_sighting ? `Last sighting ${timeAgo(stats.last_sighting)}` : 'No sightings yet'}
          </p>
          {since && (
            <p className="ov-hero-meta">
              {fmt(stats.total_crops_on_disk)} face crops stored since {since}
            </p>
          )}
        </div>

        <div className="ov-stats">
          <Link to="/persons" className="ov-stat ov-stat--link">
            <p className="ov-label"><Chip color={HUE.violet}><Icon.Person /></Chip>People identified</p>
            <p className="ov-stat-value">{fmt(stats.total_persons)}</p>
            <p className="ov-stat-sub">
              {stats.total_persons > 0 ? `${perPerson.toFixed(1)} sightings per person` : 'None yet'}
            </p>
          </Link>

          <Link to="/streams" className="ov-stat ov-stat--link">
            <p className="ov-label"><Chip color={HUE.green}><Icon.Live /></Chip>Live streams</p>
            <p className="ov-stat-value">
              {fmt(streamCount.live)}
              {streamList.length > 0 && <span className="ov-stat-of"> of {streamList.length}</span>}
            </p>
            {streamList.length > 0 && streamList.length <= 16 ? (
              <span className="ov-pips" aria-hidden="true">
                {STREAM_TONES.flatMap(t => Array.from({ length: streamCount[t] }, (_, i) => (
                  <span key={`${t}${i}`} style={{ background: STREAM_COLOR[t] }} />
                )))}
              </span>
            ) : (
              <p className="ov-stat-sub">{streamList.length ? `${streamList.length} connected` : 'None connected'}</p>
            )}
          </Link>

          <Link to="/ingest" className="ov-stat ov-stat--link">
            <p className="ov-label"><Chip color={HUE.orange}><Icon.Queue /></Chip>Videos processing</p>
            <p className="ov-stat-value">{fmt(stats.pending_jobs)}</p>
            <p className="ov-stat-sub">{stats.pending_jobs > 0 ? 'In the queue now' : 'Queue is clear'}</p>
          </Link>

          {(() => {
            const inner = (
              <>
                <p className="ov-label"><Chip color={HUE.aqua}><Icon.Camera /></Chip>Cameras</p>
                <p className="ov-stat-value">{fmt(stats.cameras.length)}</p>
                <p className="ov-stat-sub">
                  {stats.cameras.length
                    ? stats.cameras.slice(0, 2).join(', ') + (stats.cameras.length > 2 ? ` +${stats.cameras.length - 2}` : '')
                    : 'None added'}
                </p>
              </>
            );
            return canManage
              ? <Link to="/cameras" className="ov-stat ov-stat--link">{inner}</Link>
              : <div className="ov-stat">{inner}</div>;
          })()}
        </div>
      </section>

      <div className="ov-grid">
        {/* Stream status */}
        <section className="ov-panel ov-span-5" aria-labelledby="ov-status-title">
          <div className="ov-panel-head">
            <h2 id="ov-status-title">Stream status</h2>
            <Link to="/streams" className="ov-link">Manage</Link>
          </div>
          {streamList.length === 0 ? (
            <div className="ov-empty">
              <p>No streams connected.</p>
              <Link to="/streams" className="ov-link">Add a stream</Link>
            </div>
          ) : (
            <div className="ov-donut-wrap">
              <div className="ov-donut">
                <svg viewBox="0 0 120 120" role="img"
                  aria-label={donutTones.map(t => `${streamCount[t]} ${STREAM_LABEL[t].toLowerCase()}`).join(', ')}>
                  <circle cx="60" cy="60" r={R} className="ov-donut-track" />
                  {donutTones.map(t => {
                    const len = (streamCount[t] / streamList.length) * CIRC;
                    const el = (
                      <circle key={t} cx="60" cy="60" r={R} className="ov-donut-seg"
                        stroke={STREAM_COLOR[t]}
                        strokeDasharray={`${Math.max(0.01, len - gap)} ${CIRC}`}
                        strokeDashoffset={-acc}>
                        <title>{`${STREAM_LABEL[t]}: ${streamCount[t]}`}</title>
                      </circle>
                    );
                    acc += len;
                    return el;
                  })}
                </svg>
                <div className="ov-donut-center">
                  <span className="ov-donut-number">{streamList.length}</span>
                  <span className="ov-donut-caption">{streamList.length === 1 ? 'stream' : 'streams'}</span>
                </div>
              </div>
              <ul className="ov-legend">
                {STREAM_TONES.map(t => (
                  <li key={t} className={streamCount[t] === 0 ? 'ov-legend--zero' : undefined}>
                    <span className="ov-swatch" style={{ background: STREAM_COLOR[t] }} />
                    <span className="ov-legend-label">{STREAM_LABEL[t]}</span>
                    <span className="ov-legend-value">{streamCount[t]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Sightings by stream */}
        <section className="ov-panel ov-span-7" aria-labelledby="ov-bars-title">
          <div className="ov-panel-head">
            <div>
              <h2 id="ov-bars-title">Sightings by stream</h2>
              {top && topShare > 0 && byStream.length > 1 && (
                <p className="ov-insight">
                  <strong>{top.name}</strong> accounts for {topShare}% of stream sightings.
                </p>
              )}
            </div>
          </div>
          {streamSightings === 0 ? (
            <div className="ov-empty">
              <p>{streamList.length ? 'No sightings from streams yet.' : 'Connect a stream to see where people are seen.'}</p>
            </div>
          ) : (
            <>
              <ul className="ov-bars">
                {byStream.slice(0, BAR_ROWS).map(s => {
                  const v = s.sightings_added || 0;
                  const tone = streamTone(s.status);
                  return (
                    <li key={s.stream_id}
                      title={`${s.name}: ${fmt(v)} sightings, ${plural(s.persons_found, 'person', 'people')}, ${STREAM_LABEL[tone].toLowerCase()}`}>
                      <div className="ov-bar-label">
                        <span className="ov-bar-name">{s.name}</span>
                        <span className="ov-bar-sub">
                          <span className="ov-dot" style={{ background: STREAM_COLOR[tone] }} />
                          {STREAM_LABEL[tone]}, {plural(s.persons_found, 'person', 'people')}
                        </span>
                      </div>
                      <div className="ov-bar-area">
                        <span className="ov-bar" style={{ width: `${(v / maxSightings) * 100}%` }} />
                      </div>
                      <span className="ov-bar-value">{fmt(v)}</span>
                    </li>
                  );
                })}
              </ul>
              {byStream.length > BAR_ROWS && (
                <Link to="/streams" className="ov-link ov-more">See all {byStream.length} streams</Link>
              )}
            </>
          )}
        </section>

        {/* Uploads */}
        <section className="ov-panel ov-span-5" aria-labelledby="ov-uploads-title">
          <div className="ov-panel-head">
            <h2 id="ov-uploads-title">Last {jobList.length || 10} uploads</h2>
            <Link to="/ingest" className="ov-link">Upload video</Link>
          </div>
          {jobList.length === 0 ? (
            <div className="ov-empty">
              <p>No uploads yet.</p>
              <Link to="/ingest" className="ov-link">Upload a video</Link>
            </div>
          ) : (
            <>
              <div className="ov-stack" role="img"
                aria-label={JOB_TONES.map(t => `${jobCount[t]} ${JOB_LABEL[t].toLowerCase()}`).join(', ')}>
                {JOB_TONES.filter(t => jobCount[t] > 0).map(t => (
                  <span key={t} style={{ flexGrow: jobCount[t], background: JOB_COLOR[t] }}
                    title={`${JOB_LABEL[t]}: ${jobCount[t]}`} />
                ))}
              </div>
              <ul className="ov-legend ov-legend--row">
                {JOB_TONES.map(t => (
                  <li key={t} className={jobCount[t] === 0 ? 'ov-legend--zero' : undefined}>
                    <span className="ov-swatch" style={{ background: JOB_COLOR[t] }} />
                    <span className="ov-legend-label">{JOB_LABEL[t]}</span>
                    <span className="ov-legend-value">{jobCount[t]}</span>
                  </li>
                ))}
              </ul>

              {activeJobs.length > 0 ? (
                <ul className="ov-jobs">
                  {activeJobs.slice(0, 3).map(j => {
                    const pct = Math.min(100, Math.max(0, j.progress_percent || 0));
                    return (
                      <li key={j.job_id}>
                        <div className="ov-job-head">
                          <span className="ov-job-name" title={j.original_name}>{j.original_name}</span>
                          <span className="ov-job-pct">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="ov-job-track" role="progressbar"
                          aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
                          aria-label={`${j.original_name} progress`}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="ov-allclear"><span style={{ color: STATUS.good }}><Icon.Check /></span>All uploads processed</p>
              )}
            </>
          )}
        </section>

        {/* People: small crops in the corner */}
        <section className="ov-panel ov-span-7" aria-labelledby="ov-people-title">
          <div className="ov-panel-head">
            <h2 id="ov-people-title">Recently identified</h2>
            <Link to="/persons" className="ov-link">See all</Link>
          </div>
          {peopleList.length === 0 ? (
            <div className="ov-empty"><p>No one identified yet.</p></div>
          ) : (
            <ul className="ov-people">
              {peopleList.map(p => (
                <li key={p.id}>
                  <Link to={`/persons/${p.id}`} className="ov-person">
                    <span className="ov-crop">
                      <AuthenticatedImage
                        src={p.latest_crop_url ? cropUrl(p.latest_crop_url) : undefined}
                        alt={p.label || `Person ${p.id}`}
                        style={{ width: '100%', height: '100%', borderRadius: 0 }}
                      />
                    </span>
                    <span className="ov-person-text">
                      <span className={`ov-person-name${p.label ? '' : ' ov-person-name--none'}`}>
                        {p.label || `Unnamed #${p.id}`}
                      </span>
                      <span className="ov-person-meta">{plural(p.sighting_count, 'sighting', 'sightings')}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const styles = `
.ov {
  --ov-ink: #0b0b0b;
  --ov-ink-2: #52514e;
  --ov-muted: #898781;
  --ov-line: rgba(11, 11, 11, 0.09);
  --ov-grid: #ecebe6;
  --ov-panel: #ffffff;
  --ov-wash: #f6f6f3;
  --ov-blue: #2a78d6;
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px 24px 80px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--ov-ink);
  -webkit-font-smoothing: antialiased;
}
.ov-message { min-height: 40vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: var(--ov-ink-2); }
.ov-message p { margin: 0; }
.ov :where(p) { margin: 0; }
.ov-muted { color: var(--ov-muted); font-size: 13px; }

.ov-link { color: var(--ov-blue); text-decoration: none; font-weight: 500; white-space: nowrap; }
.ov-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.ov a:focus-visible, .ov button:focus-visible { outline: 2px solid var(--ov-blue); outline-offset: 2px; }

.ov-button {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px;
  border: 1px solid var(--ov-line); border-radius: 9px;
  background: var(--ov-panel); color: var(--ov-ink);
  font: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer;
}
.ov-button:hover:not(:disabled) { background: var(--ov-wash); }
.ov-button:disabled { cursor: default; color: var(--ov-ink-2); }
.ov-button svg { display: block; }
.ov-spin { display: inline-flex; animation: ov-spin 0.8s linear infinite; }
@keyframes ov-spin { to { transform: rotate(360deg); } }

/* Header */
.ov-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.ov-header h1 { margin: 0 0 2px; font-size: 26px; font-weight: 650; letter-spacing: -0.02em; }

/* Health banner */
.ov-health {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; margin-bottom: 16px;
  border-radius: 12px;
}
.ov-health p { flex: 1; min-width: 0; color: var(--ov-ink-2); }
.ov-health strong { color: var(--ov-ink); font-weight: 600; }
.ov-health-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: #fff; flex-shrink: 0; }
.ov-health--ok { background: #e9f6e9; }
.ov-health--ok .ov-health-icon { background: #0ca30c; }
.ov-health--alert { background: #fbeaea; }
.ov-health--alert .ov-health-icon { background: #d03b3b; }
.ov-health--alert strong { color: #a82424; }
.ov-health--idle { background: var(--ov-wash); }
.ov-health--idle .ov-health-icon { background: #898781; }
.ov-health-action {
  flex-shrink: 0; padding: 6px 12px; border-radius: 8px;
  background: #fff; color: var(--ov-ink); font-weight: 500; text-decoration: none;
  border: 1px solid var(--ov-line);
}
.ov-health-action:hover { background: var(--ov-wash); }

/* Panels */
.ov-panel {
  display: flex;
  flex-direction: column;
  padding: 20px 22px;
  border: 1px solid var(--ov-line);
  border-radius: 14px;
  background: var(--ov-panel);
}
.ov-panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
.ov-panel-head h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.ov-insight { margin-top: 4px; font-size: 13px; color: var(--ov-ink-2); }
.ov-insight strong { color: var(--ov-ink); font-weight: 600; }
.ov-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.ov-span-5 { grid-column: span 5; min-width: 0; }
.ov-span-7 { grid-column: span 7; min-width: 0; }
.ov-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 150px; color: var(--ov-ink-2); text-align: center; }

.ov-chip { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0; }
.ov-label { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 500; color: var(--ov-ink-2); }

/* Summary */
.ov-summary { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 3fr); padding: 0; }
.ov-hero { padding: 22px 24px; border-right: 1px solid var(--ov-line); }
.ov-hero-value { margin-top: 14px; font-size: 52px; font-weight: 650; letter-spacing: -0.035em; line-height: 1; }
.ov-hero-sub { margin-top: 10px; color: var(--ov-ink-2); }
.ov-hero-meta { margin-top: 2px; font-size: 13px; color: var(--ov-muted); }
.ov-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ov-stat { display: flex; flex-direction: column; min-width: 0; padding: 22px 20px; color: inherit; text-decoration: none; }
.ov-stat + .ov-stat { border-left: 1px solid var(--ov-line); }
.ov-stat--link:hover { background: var(--ov-wash); }
.ov-stat:last-child { border-radius: 0 14px 14px 0; }
.ov-stat-value { margin-top: 14px; font-size: 32px; font-weight: 650; letter-spacing: -0.025em; line-height: 1.1; }
.ov-stat-of { font-size: 16px; font-weight: 500; color: var(--ov-muted); letter-spacing: 0; }
.ov-stat-sub { margin-top: 6px; font-size: 13px; color: var(--ov-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ov-pips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 10px; }
.ov-pips span { width: 14px; height: 8px; border-radius: 2px; }

/* Donut */
.ov-donut-wrap { flex: 1; display: flex; align-items: center; gap: 28px; }
.ov-donut { position: relative; width: 156px; height: 156px; flex-shrink: 0; }
.ov-donut svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ov-donut-track { fill: none; stroke: var(--ov-wash); stroke-width: 14; }
.ov-donut-seg { fill: none; stroke-width: 14; }
.ov-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ov-donut-number { font-size: 30px; font-weight: 650; letter-spacing: -0.02em; line-height: 1.1; }
.ov-donut-caption { font-size: 12px; color: var(--ov-muted); }

.ov-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; flex: 1; min-width: 0; }
.ov-legend li { display: flex; align-items: center; gap: 10px; }
.ov-legend-label { flex: 1; color: var(--ov-ink-2); }
.ov-legend-value { font-weight: 600; font-variant-numeric: tabular-nums; }
.ov-legend--zero { opacity: 0.45; }
.ov-legend--row { flex: none; flex-direction: row; flex-wrap: wrap; gap: 6px 20px; margin-top: 12px; }
.ov-legend--row .ov-legend-label { flex: none; }
.ov-swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }

/* Bars */
.ov-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.ov-bars li { display: grid; grid-template-columns: minmax(0, 190px) minmax(0, 1fr) 64px; align-items: center; gap: 14px; }
.ov-bar-label { display: flex; flex-direction: column; min-width: 0; }
.ov-bar-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ov-bar-sub { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ov-muted); white-space: nowrap; overflow: hidden; }
.ov-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ov-bar-area { height: 14px; border-left: 1px solid #c3c2b7; display: flex; align-items: center; }
.ov-bar { display: block; height: 14px; min-width: 2px; border-radius: 0 4px 4px 0; background: var(--ov-blue); }
.ov-bar-value { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.ov-more { display: inline-block; margin-top: 14px; }

/* Uploads */
.ov-stack { display: flex; gap: 2px; height: 14px; }
.ov-stack span { flex-basis: 0; min-width: 4px; border-radius: 2px; }
.ov-stack span:first-child { border-radius: 4px 2px 2px 4px; }
.ov-stack span:last-child { border-radius: 2px 4px 4px 2px; }
.ov-stack span:only-child { border-radius: 4px; }
.ov-jobs { list-style: none; margin: 18px 0 0; padding: 16px 0 0; border-top: 1px solid var(--ov-grid); display: flex; flex-direction: column; gap: 12px; }
.ov-job-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 5px; font-size: 13px; }
.ov-job-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.ov-job-pct { color: var(--ov-ink-2); font-variant-numeric: tabular-nums; }
.ov-job-track { height: 6px; border-radius: 3px; background: #dbe8f8; overflow: hidden; }
.ov-job-track span { display: block; height: 100%; border-radius: 3px; background: var(--ov-blue); transition: width 0.6s ease; }
.ov-allclear { display: flex; align-items: center; gap: 8px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--ov-grid); color: var(--ov-ink-2); }

/* People: small crops */
.ov-people { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.ov-person { display: flex; align-items: center; gap: 12px; padding: 6px; margin: -6px; border-radius: 10px; color: inherit; text-decoration: none; min-width: 0; }
.ov-person:hover { background: var(--ov-wash); }
.ov-crop { width: 44px; height: 44px; border-radius: 9px; overflow: hidden; flex-shrink: 0; background: var(--ov-wash); }
.ov-person-text { display: flex; flex-direction: column; min-width: 0; }
.ov-person-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ov-person-name--none { color: var(--ov-muted); font-weight: 400; }
.ov-person-meta { font-size: 12px; color: var(--ov-muted); }

/* Loading */
.ov-skel { border-radius: 14px; background: var(--ov-wash); }

/* Responsive */
@media (max-width: 1000px) {
  .ov-summary { grid-template-columns: minmax(0, 1fr); }
  .ov-hero { border-right: 0; border-bottom: 1px solid var(--ov-line); }
  .ov-stat:last-child { border-radius: 0 0 14px 0; }
  .ov-span-5, .ov-span-7 { grid-column: span 12; }
}
@media (max-width: 640px) {
  .ov { padding: 20px 16px 64px; }
  .ov-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ov-stat:nth-child(3) { border-left: 0; }
  .ov-stat:nth-child(n + 3) { border-top: 1px solid var(--ov-line); }
  .ov-stat:last-child { border-radius: 0 0 14px 0; }
  .ov-stat-value { font-size: 28px; }
  .ov-hero-value { font-size: 44px; }
  .ov-health { flex-wrap: wrap; align-items: flex-start; }
  .ov-health p { flex-basis: calc(100% - 40px); padding-top: 4px; }
  .ov-health-action { margin-left: 40px; }
  .ov-donut-wrap { flex-direction: column; align-items: stretch; }
  .ov-donut { margin: 0 auto; }
  .ov-bars li { grid-template-columns: minmax(0, 1fr) 56px; row-gap: 6px; }
  .ov-bar-label { grid-column: 1 / -1; }
  .ov-people { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .ov *, .ov *::before, .ov *::after { animation: none !important; transition: none !important; }
}
`;