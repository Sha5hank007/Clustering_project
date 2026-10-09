import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { cropUrl } from '../api/utils';
import { Stats, IngestJob, Person } from '../types';
import { useAuth } from '../context/AuthContext';
import AuthenticatedImage from '../components/AuthenticatedImage';
import Reveal from '../components/Reveal';

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface Stream {
  stream_id: string;
  name: string;
  camera_id: string;
  status: string;
  persons_found: number;
  sightings_added: number;
}

const C = {
  blue: '#0071e3',
  indigo: '#5e5ce6',
  purple: '#af52de',
  green: '#34c759',
  orange: '#ff9f0a',
  teal: '#30b0c7',
  red: '#ff3b30',
  gray: '#c7c7cc',
};
const BAR_COLORS = [C.blue, C.purple, C.teal, C.green, C.orange, C.indigo];
const REFRESH_MS = 20000;

type StreamTone = 'live' | 'paused' | 'stopped' | 'failed' | 'pending';
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

type JobTone = 'done' | 'active' | 'failed';
function jobTone(status: string): JobTone {
  const s = (status || '').toLowerCase();
  if (['completed', 'complete', 'done', 'finished', 'success', 'succeeded'].includes(s)) return 'done';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed';
  return 'active';
}

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
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Animates a number from its previous value to the new one. */
function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { current.current = value; setDisplay(value); return; }
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (value - from) * eased);
      current.current = next;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{display.toLocaleString()}</>;
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const svgProps = {
  viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
};
const Icon = {
  Eye: () => <svg {...svgProps}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  Person: () => <svg {...svgProps}><circle cx="12" cy="8.5" r="3.75" /><path d="M4.5 20c.9-3.6 3.9-5.75 7.5-5.75s6.6 2.15 7.5 5.75" /></svg>,
  Live: () => <svg {...svgProps}><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></svg>,
  Queue: () => <svg {...svgProps}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>,
  Camera: () => <svg {...svgProps}><path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" /><rect x="3" y="6" width="12" height="12" rx="2" /></svg>,
  Check: () => <svg {...svgProps} strokeWidth={2.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  Alert: () => <svg {...svgProps} strokeWidth={2}><path d="M12 8v5M12 16.5v.01" /><path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  Moon: () => <svg {...svgProps}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>,
};

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
  const hasStats = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [st, sr, jb, pp] = await Promise.allSettled([
        api.get('/stats'),
        api.get('/streams'),
        api.get('/ingest/jobs', { params: { page: 1, limit: 10 } }),
        api.get('/persons', { params: { page: 1, limit: 8 } }),
      ]);
      if (cancelled) return;

      if (st.status === 'fulfilled') {
        hasStats.current = true;
        setStats(st.value.data);
        setError('');
      } else if (!hasStats.current) {
        const err: any = st.reason;
        setError(err?.response?.data?.detail || 'Unable to load dashboard data');
      }
      if (sr.status === 'fulfilled') {
        const d = sr.value.data;
        setStreams(Array.isArray(d) ? d : d.streams || []);
      }
      if (jb.status === 'fulfilled') setJobs(jb.value.data.jobs || []);
      if (pp.status === 'fulfilled') setPeople(pp.value.data.persons || []);
      setUpdatedAt(new Date());
    };

    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (error) {
    return (
      <div className="db-state" role="alert">
        <style>{styles}</style>
        {error}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="db" aria-busy="true" aria-label="Loading dashboard">
        <style>{styles}</style>
        <div className="db-skel db-skel--title" />
        <div className="db-skel db-skel--banner" />
        <div className="db-bento">
          <div className="db-skel db-hero" />
          {[0, 1, 2, 3].map(i => <div key={i} className="db-skel db-kpi" />)}
          <div className="db-skel db-span-5 db-skel--tall" />
          <div className="db-skel db-span-7 db-skel--tall" />
        </div>
      </div>
    );
  }

  /* ---------- derived data ---------- */

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const streamList = streams ?? [];
  const jobList = jobs ?? [];
  const toneCount = (t: StreamTone) => streamList.filter(s => streamTone(s.status) === t).length;
  const liveCount = toneCount('live');
  const failedStreams = streamList.filter(s => streamTone(s.status) === 'failed');
  const failedJobs = jobList.filter(j => jobTone(j.status) === 'failed');
  const activeJobs = jobList.filter(j => jobTone(j.status) === 'active');
  const doneJobs = jobList.filter(j => jobTone(j.status) === 'done');

  // Overall health — what the user should see first
  const issues: string[] = [];
  if (failedStreams.length) issues.push(`${plural(failedStreams.length, 'stream', 'streams')} stopped with an error`);
  if (failedJobs.length) issues.push(`${plural(failedJobs.length, 'recent upload', 'recent uploads')} failed`);

  let health: { tone: 'alert' | 'ok' | 'idle'; title: string; detail: string; href?: string; action?: string };
  if (issues.length) {
    health = {
      tone: 'alert',
      title: 'Needs attention',
      detail: issues.join(' · '),
      href: failedStreams.length ? '/streams' : '/ingest',
      action: 'Review',
    };
  } else if (liveCount > 0 || stats.pending_jobs > 0) {
    const parts = [];
    if (liveCount > 0) parts.push(`${plural(liveCount, 'stream', 'streams')} live`);
    if (stats.pending_jobs > 0) parts.push(`${plural(stats.pending_jobs, 'video', 'videos')} processing`);
    health = { tone: 'ok', title: 'Everything is running', detail: parts.join(' · ') };
  } else {
    health = {
      tone: 'idle',
      title: 'Nothing running right now',
      detail: 'No live streams or uploads in progress.',
      href: '/streams',
      action: 'Start a stream',
    };
  }

  const perPerson = stats.total_persons > 0 ? stats.total_sightings / stats.total_persons : 0;

  // Donut: stream status breakdown
  const donutSegments = [
    { key: 'live', label: 'Live', color: C.green, count: liveCount },
    { key: 'paused', label: 'Paused', color: C.orange, count: toneCount('paused') },
    { key: 'pending', label: 'Starting', color: C.blue, count: toneCount('pending') },
    { key: 'failed', label: 'Error', color: C.red, count: failedStreams.length },
    { key: 'stopped', label: 'Stopped', color: C.gray, count: toneCount('stopped') },
  ].filter(s => s.count > 0);
  const R = 52;
  const CIRC = 2 * Math.PI * R;
  const gap = donutSegments.length > 1 ? 3 : 0;
  let acc = 0;

  // Bars: sightings per stream
  const topStreams = [...streamList]
    .sort((a, b) => (b.sightings_added || 0) - (a.sightings_added || 0))
    .slice(0, 6);
  const maxSightings = Math.max(1, ...topStreams.map(s => s.sightings_added || 0));
  const anySightings = topStreams.some(s => (s.sightings_added || 0) > 0);

  const kpis = [
    {
      key: 'people', label: 'People', value: stats.total_persons, color: C.purple, icon: <Icon.Person />,
      href: '/persons',
      context: stats.total_persons > 0 ? `${perPerson.toFixed(1)} sightings each` : 'None identified yet',
    },
    {
      key: 'live', label: 'Live streams', value: stats.active_streams, color: C.green, icon: <Icon.Live />,
      href: '/streams', pulse: stats.active_streams > 0,
      context: streams ? (streamList.length ? `of ${streamList.length} connected` : 'None connected') : '',
    },
    {
      key: 'queue', label: 'Processing', value: stats.pending_jobs, color: C.orange, icon: <Icon.Queue />,
      href: '/ingest', pulse: stats.pending_jobs > 0,
      context: stats.pending_jobs > 0 ? 'videos in the queue' : 'Queue is clear',
    },
    {
      key: 'cameras', label: 'Cameras', value: stats.cameras.length, color: C.teal, icon: <Icon.Camera />,
      href: canManage ? '/cameras' : undefined,
      context: stats.cameras.length ? stats.cameras.slice(0, 2).join(', ') + (stats.cameras.length > 2 ? '…' : '') : 'None yet',
    },
  ];

  return (
    <div className="db">
      <style>{styles}</style>

      {/* Header */}
      <Reveal className="db-header">
        <div>
          <p className="db-date">{today}</p>
          <h1 className="db-title">{greeting}</h1>
        </div>
        {updatedAt && (
          <p className="db-updated">
            <span className="db-updated-dot" aria-hidden="true" />
            Updated {updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </Reveal>

      {/* Health banner */}
      <Reveal delay={60}>
        <section className={`db-banner db-banner--${health.tone}`} role="status">
          <span className="db-banner-icon">
            {health.tone === 'alert' ? <Icon.Alert /> : health.tone === 'ok' ? <Icon.Check /> : <Icon.Moon />}
          </span>
          <div className="db-banner-text">
            <p className="db-banner-title">{health.title}</p>
            <p className="db-banner-detail">{health.detail}</p>
          </div>
          {health.href && (
            <Link to={health.href} className="db-banner-action">
              {health.action} <span aria-hidden="true">›</span>
            </Link>
          )}
        </section>
      </Reveal>

      <div className="db-bento">
        {/* Hero: sightings */}
        <Reveal className="db-hero" delay={120}>
          <div className="db-hero-tile">
            <div className="db-hero-glow" aria-hidden="true" />
            <div className="db-hero-top">
              <span className="db-hero-icon"><Icon.Eye /></span>
              <span className="db-hero-label">Total sightings</span>
            </div>
            <p className="db-hero-value"><CountUp value={stats.total_sightings} /></p>
            <p className="db-hero-context">
              {stats.last_sighting ? <>Last sighting {timeAgo(stats.last_sighting)}</> : 'No activity yet'}
            </p>
            <dl className="db-hero-stats">
              <div><dt>First seen</dt><dd>{shortDate(stats.first_sighting)}</dd></div>
              <div><dt>Latest</dt><dd>{shortDate(stats.last_sighting)}</dd></div>
              <div><dt>Saved crops</dt><dd>{stats.total_crops_on_disk.toLocaleString()}</dd></div>
            </dl>
          </div>
        </Reveal>

        {/* KPI tiles */}
        {kpis.map((k, i) => {
          const inner = (
            <>
              <div className="db-kpi-top">
                <span className="db-kpi-icon" style={{ color: k.color, background: `${k.color}1f` }}>{k.icon}</span>
                {k.pulse && <span className="db-pulse" style={{ background: k.color }} aria-hidden="true" />}
              </div>
              <p className="db-kpi-value"><CountUp value={k.value} /></p>
              <p className="db-kpi-label">
                {k.label}
                {k.href && <span className="db-kpi-chevron" aria-hidden="true">›</span>}
              </p>
              <p className="db-kpi-context">{k.context}</p>
            </>
          );
          return (
            <Reveal key={k.key} className="db-kpi" delay={160 + i * 50}>
              {k.href
                ? <Link to={k.href} className="db-tile db-tile--link">{inner}</Link>
                : <div className="db-tile">{inner}</div>}
            </Reveal>
          );
        })}

        {/* Streams donut */}
        <Reveal className="db-span-5" delay={120}>
          <section className="db-tile db-tile--chart" aria-labelledby="db-streams-title">
            <div className="db-tile-head">
              <h2 id="db-streams-title">Streams</h2>
              <Link to="/streams" className="db-more">Open <span aria-hidden="true">›</span></Link>
            </div>
            {streamList.length === 0 ? (
              <div className="db-empty">
                <p>No streams connected.</p>
                <Link to="/streams" className="db-more">Add a stream <span aria-hidden="true">›</span></Link>
              </div>
            ) : (
              <div className="db-donut-wrap">
                <div className="db-donut">
                  <svg viewBox="0 0 128 128" aria-hidden="true">
                    <circle cx="64" cy="64" r={R} className="db-donut-track" />
                    {donutSegments.map((seg, i) => {
                      const len = (seg.count / streamList.length) * CIRC;
                      const dash = Math.max(0.01, len - gap);
                      const el = (
                        <circle
                          key={seg.key}
                          cx="64" cy="64" r={R}
                          className="db-donut-seg"
                          stroke={seg.color}
                          strokeDasharray={`${dash} ${CIRC}`}
                          strokeDashoffset={-acc}
                          style={{ animationDelay: `${250 + i * 120}ms` }}
                        />
                      );
                      acc += len;
                      return el;
                    })}
                  </svg>
                  <div className="db-donut-center">
                    <span className="db-donut-number"><CountUp value={streamList.length} /></span>
                    <span className="db-donut-caption">{streamList.length === 1 ? 'stream' : 'streams'}</span>
                  </div>
                </div>
                <ul className="db-legend">
                  {donutSegments.map(seg => (
                    <li key={seg.key}>
                      <span className="db-legend-swatch" style={{ background: seg.color }} />
                      <span className="db-legend-label">{seg.label}</span>
                      <span className="db-legend-value">{seg.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </Reveal>

        {/* Sightings by stream */}
        <Reveal className="db-span-7" delay={180}>
          <section className="db-tile db-tile--chart" aria-labelledby="db-bars-title">
            <div className="db-tile-head">
              <h2 id="db-bars-title">Sightings by stream</h2>
              {topStreams.length > 0 && <span className="db-muted">Top {topStreams.length}</span>}
            </div>
            {!anySightings ? (
              <div className="db-empty">
                <p>{streamList.length ? 'No sightings from live streams yet.' : 'Connect a stream to see where people are spotted.'}</p>
              </div>
            ) : (
              <ul className="db-bars">
                {topStreams.map((s, i) => {
                  const value = s.sightings_added || 0;
                  const color = BAR_COLORS[i % BAR_COLORS.length];
                  const live = streamTone(s.status) === 'live';
                  return (
                    <li key={s.stream_id} title={`${s.name}: ${value.toLocaleString()} sightings, ${s.persons_found} people`}>
                      <div className="db-bar-head">
                        <span className="db-bar-name">
                          {live && <span className="db-live-dot" aria-label="Live" />}
                          {s.name}
                        </span>
                        <span className="db-bar-value">{value.toLocaleString()}</span>
                      </div>
                      <div className="db-bar-track">
                        <span
                          className="db-bar-fill"
                          style={{
                            width: `${Math.max(value > 0 ? 2 : 0, (value / maxSightings) * 100)}%`,
                            background: `linear-gradient(90deg, ${color}cc, ${color})`,
                            animationDelay: `${300 + i * 80}ms`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </Reveal>

        {/* Uploads pipeline */}
        <Reveal className="db-span-5" delay={120}>
          <section className="db-tile db-tile--chart" aria-labelledby="db-uploads-title">
            <div className="db-tile-head">
              <h2 id="db-uploads-title">Recent uploads</h2>
              <Link to="/ingest" className="db-more">Upload <span aria-hidden="true">›</span></Link>
            </div>
            {jobList.length === 0 ? (
              <div className="db-empty"><p>No uploads yet.</p></div>
            ) : (
              <>
                <div className="db-stack" role="img"
                  aria-label={`${doneJobs.length} done, ${activeJobs.length} processing, ${failedJobs.length} failed`}>
                  {[
                    { n: doneJobs.length, color: C.green },
                    { n: activeJobs.length, color: C.orange },
                    { n: failedJobs.length, color: C.red },
                  ].filter(s => s.n > 0).map((s, i) => (
                    <span key={i} className="db-stack-seg"
                      style={{ flexGrow: s.n, background: s.color, animationDelay: `${300 + i * 100}ms` }} />
                  ))}
                </div>
                <ul className="db-legend db-legend--row">
                  <li><span className="db-legend-swatch" style={{ background: C.green }} /><span className="db-legend-label">Done</span><span className="db-legend-value">{doneJobs.length}</span></li>
                  <li><span className="db-legend-swatch" style={{ background: C.orange }} /><span className="db-legend-label">Processing</span><span className="db-legend-value">{activeJobs.length}</span></li>
                  <li><span className="db-legend-swatch" style={{ background: C.red }} /><span className="db-legend-label">Failed</span><span className="db-legend-value">{failedJobs.length}</span></li>
                </ul>

                {activeJobs.length > 0 ? (
                  <ul className="db-jobs">
                    {activeJobs.slice(0, 3).map(j => {
                      const pct = Math.min(100, Math.max(0, j.progress_percent || 0));
                      return (
                        <li key={j.job_id}>
                          <div className="db-job-head">
                            <span className="db-job-name">{j.original_name}</span>
                            <span className="db-job-pct">{pct.toFixed(0)}%</span>
                          </div>
                          <div className="db-job-track">
                            <span style={{ transform: `scaleX(${pct / 100})` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="db-allclear"><span style={{ color: C.green }}><Icon.Check /></span>All recent uploads processed</p>
                )}
              </>
            )}
          </section>
        </Reveal>

        {/* People */}
        <Reveal className="db-span-7" delay={180}>
          <section className="db-tile db-tile--chart" aria-labelledby="db-people-title">
            <div className="db-tile-head">
              <h2 id="db-people-title">People</h2>
              <Link to="/persons" className="db-more">See all <span aria-hidden="true">›</span></Link>
            </div>
            {!people || people.length === 0 ? (
              <div className="db-empty"><p>No one identified yet.</p></div>
            ) : (
              <ul className="db-faces">
                {people.slice(0, 8).map((p, i) => (
                  <li key={p.id} style={{ animationDelay: `${250 + i * 50}ms` }}>
                    <Link to={`/persons/${p.id}`} className="db-face">
                      <AuthenticatedImage
                        src={p.latest_crop_url ? cropUrl(p.latest_crop_url) : undefined}
                        alt={p.label || `Person #${p.id}`}
                        style={{ width: '100%', height: '100%', borderRadius: 16 }}
                      />
                      <span className="db-face-name">{p.label || `#${p.id}`}</span>
                      <span className="db-face-meta">{plural(p.sighting_count, 'sighting', 'sightings')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Reveal>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const styles = `
.db, .db-state {
  --db-text: #1d1d1f;
  --db-muted: #6e6e73;
  --db-faint: #86868b;
  --db-line: rgba(0, 0, 0, 0.08);
  --db-tile: #f5f5f7;
  --db-accent: #0071e3;
  --db-ease: cubic-bezier(0.22, 1, 0.36, 1);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: var(--db-text);
  -webkit-font-smoothing: antialiased;
}
.db { max-width: 1160px; margin: 0 auto; padding: 48px 24px 112px; }
.db-state { min-height: 50vh; display: grid; place-items: center; color: var(--db-muted); font-size: 17px; }
.db-muted { font-size: 14px; color: var(--db-faint); }

/* Header */
.db-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px 24px; margin-bottom: 24px; }
.db-date { margin: 0 0 4px; font-size: 15px; font-weight: 500; color: var(--db-muted); }
.db-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 4.5vw, 44px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.08;
}
.db-updated { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; color: var(--db-faint); }
.db-updated-dot { width: 6px; height: 6px; border-radius: 50%; background: #34c759; }

/* Health banner */
.db-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  margin-bottom: 16px;
  border-radius: 20px;
  transition: background 0.4s var(--db-ease);
}
.db-banner--ok { background: rgba(52, 199, 89, 0.11); --db-tone: #1f8a3c; }
.db-banner--alert { background: rgba(255, 59, 48, 0.1); --db-tone: #d70015; }
.db-banner--idle { background: var(--db-tile); --db-tone: #6e6e73; }
.db-banner-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--db-tone);
  color: #fff;
  flex-shrink: 0;
}
.db-banner--alert .db-banner-icon { animation: db-attn 2s ease-in-out infinite; }
@keyframes db-attn { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.35); } 50% { box-shadow: 0 0 0 8px rgba(255, 59, 48, 0); } }
.db-banner-text { flex: 1; min-width: 0; }
.db-banner-title { margin: 0; font-size: 17px; font-weight: 600; color: var(--db-tone); letter-spacing: -0.01em; }
.db-banner-detail { margin: 2px 0 0; font-size: 15px; color: var(--db-muted); }
.db-banner-action {
  flex-shrink: 0;
  padding: 8px 16px;
  border-radius: 980px;
  background: #fff;
  color: var(--db-tone);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  transition: transform 0.2s var(--db-ease), box-shadow 0.2s var(--db-ease);
}
.db-banner-action:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); }

/* Bento grid */
.db-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
.db-hero { grid-column: span 6; grid-row: span 2; }
.db-kpi { grid-column: span 3; }
.db-span-5 { grid-column: span 5; }
.db-span-7 { grid-column: span 7; }

.db-tile {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 22px;
  border-radius: 24px;
  background: var(--db-tile);
  color: inherit;
  text-decoration: none;
  transition: transform 0.4s var(--db-ease), box-shadow 0.4s var(--db-ease), background 0.3s var(--db-ease);
}
.db-tile--link:hover { transform: translateY(-3px); background: #fff; box-shadow: 0 0 0 1px var(--db-line), 0 18px 40px -16px rgba(0, 0, 0, 0.18); }
.db-tile--link:active { transform: translateY(-1px) scale(0.99); }
.db-tile--link:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.4); }
.db-tile--chart { padding: 24px 26px 26px; }

/* Hero tile */
.db-hero-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 340px;
  padding: 28px;
  border-radius: 28px;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(140deg, #0a84ff 0%, #0060df 45%, #5e5ce6 100%);
  box-shadow: 0 30px 60px -30px rgba(0, 96, 223, 0.55);
}
.db-hero-glow {
  position: absolute;
  width: 420px; height: 420px;
  right: -140px; top: -160px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 65%);
  animation: db-glow 14s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes db-glow { to { transform: translate(-80px, 90px) scale(1.15); } }
.db-hero-top { position: relative; display: flex; align-items: center; gap: 10px; }
.db-hero-icon {
  display: grid;
  place-items: center;
  width: 34px; height: 34px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.2);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.db-hero-label { font-size: 15px; font-weight: 500; opacity: 0.9; }
.db-hero-value {
  position: relative;
  margin: auto 0 6px;
  padding-top: 36px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(64px, 9vw, 104px);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.db-hero-context { position: relative; margin: 0; font-size: 17px; opacity: 0.85; }
.db-hero-stats {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 28px 0 0;
  padding-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.22);
}
.db-hero-stats dt { font-size: 12px; opacity: 0.75; }
.db-hero-stats dd { margin: 3px 0 0; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }

/* KPI tiles */
.db-kpi-top { display: flex; justify-content: space-between; align-items: center; }
.db-kpi-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; }
.db-pulse { position: relative; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.db-pulse::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: db-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes db-ping { 75%, 100% { transform: scale(2.8); opacity: 0; } }
.db-kpi-value {
  margin: 22px 0 2px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.db-kpi-label { display: flex; align-items: center; gap: 4px; margin: 0; font-size: 15px; font-weight: 600; }
.db-kpi-chevron { color: var(--db-faint); font-size: 18px; line-height: 1; transition: transform 0.3s var(--db-ease); }
.db-tile--link:hover .db-kpi-chevron { transform: translateX(3px); color: var(--db-accent); }
.db-kpi-context {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--db-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Chart tiles */
.db-tile-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; }
.db-tile-head h2 { margin: 0; font-size: 19px; font-weight: 600; letter-spacing: -0.015em; }
.db-more { font-size: 14px; color: var(--db-accent); text-decoration: none; white-space: nowrap; }
.db-more span { display: inline-block; transition: transform 0.25s var(--db-ease); }
.db-more:hover span { transform: translateX(3px); }
.db-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 160px; text-align: center; }
.db-empty p { margin: 0; font-size: 15px; color: var(--db-muted); }

/* Donut */
.db-donut-wrap { display: flex; align-items: center; gap: 28px; flex: 1; }
.db-donut { position: relative; width: 168px; height: 168px; flex-shrink: 0; }
.db-donut svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.db-donut-track { fill: none; stroke: rgba(0, 0, 0, 0.06); stroke-width: 16; }
.db-donut-seg {
  fill: none;
  stroke-width: 16;
  stroke-linecap: butt;
  animation: db-donut 1.1s var(--db-ease) both;
}
@keyframes db-donut { from { stroke-dasharray: 0 400; } }
.db-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.db-donut-number { font-size: 34px; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.db-donut-caption { font-size: 13px; color: var(--db-faint); }

.db-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; flex: 1; min-width: 0; }
.db-legend li { display: flex; align-items: center; gap: 10px; font-size: 15px; }
.db-legend-swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.db-legend-label { flex: 1; color: var(--db-muted); }
.db-legend-value { font-weight: 600; font-variant-numeric: tabular-nums; }
.db-legend--row { flex-direction: row; flex-wrap: wrap; gap: 8px 20px; margin-top: 14px; }
.db-legend--row li { font-size: 14px; }
.db-legend--row .db-legend-label { flex: none; }

/* Bars */
.db-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
.db-bar-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 7px; }
.db-bar-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 15px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-bar-value { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.db-bar-track { height: 10px; border-radius: 6px; background: rgba(0, 0, 0, 0.06); overflow: hidden; }
.db-bar-fill {
  display: block;
  height: 100%;
  border-radius: 6px;
  transform-origin: left center;
  animation: db-grow 1s var(--db-ease) both;
}
@keyframes db-grow { from { transform: scaleX(0); } }
.db-live-dot { position: relative; width: 7px; height: 7px; border-radius: 50%; background: #34c759; flex-shrink: 0; }
.db-live-dot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: db-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}

/* Uploads */
.db-stack { display: flex; gap: 3px; height: 14px; border-radius: 8px; overflow: hidden; }
.db-stack-seg { flex-basis: 0; border-radius: 3px; transform-origin: left center; animation: db-grow 0.9s var(--db-ease) both; }
.db-jobs { list-style: none; margin: 22px 0 0; padding: 18px 0 0; border-top: 1px solid var(--db-line); display: flex; flex-direction: column; gap: 14px; }
.db-job-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; font-size: 14px; }
.db-job-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.db-job-pct { color: var(--db-muted); font-variant-numeric: tabular-nums; }
.db-job-track { height: 4px; border-radius: 3px; background: rgba(0, 0, 0, 0.07); overflow: hidden; }
.db-job-track span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #ff9f0a, #ffb340);
  transform-origin: left center;
  transition: transform 0.8s var(--db-ease);
}
.db-allclear { display: flex; align-items: center; gap: 8px; margin: 22px 0 0; padding-top: 18px; border-top: 1px solid var(--db-line); font-size: 14px; color: var(--db-muted); }

/* Faces */
.db-faces { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px 14px; }
.db-faces li { animation: db-rise 0.6s var(--db-ease) both; }
@keyframes db-rise { from { opacity: 0; transform: translateY(10px); } }
.db-face { display: flex; flex-direction: column; color: inherit; text-decoration: none; min-width: 0; }
.db-face > .aimg { aspect-ratio: 1; height: auto !important; transition: transform 0.4s var(--db-ease), box-shadow 0.4s var(--db-ease); }
.db-face:hover > .aimg { transform: translateY(-3px); box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.3); }
.db-face-name { margin-top: 8px; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-face-meta { font-size: 12px; color: var(--db-faint); }

/* Skeleton */
.db-skel {
  border-radius: 24px;
  background: linear-gradient(90deg, #f0f0f2 0%, #f7f7f9 50%, #f0f0f2 100%);
  background-size: 200% 100%;
  animation: db-shimmer 1.4s ease-in-out infinite;
  min-height: 160px;
}
.db-skel--title { width: 260px; height: 48px; min-height: 0; margin-bottom: 24px; border-radius: 12px; }
.db-skel--banner { height: 76px; min-height: 0; margin-bottom: 16px; border-radius: 20px; }
.db-skel.db-hero { min-height: 340px; }
.db-skel--tall { min-height: 280px; }
@keyframes db-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }

/* Responsive */
@media (max-width: 1000px) {
  .db-hero { grid-column: span 12; grid-row: auto; }
  .db-kpi { grid-column: span 6; }
  .db-span-5, .db-span-7 { grid-column: span 12; }
  .db-hero-tile { min-height: 280px; }
}
@media (max-width: 560px) {
  .db { padding: 32px 16px 80px; }
  .db-bento { gap: 12px; }
  .db-tile { padding: 18px; border-radius: 20px; }
  .db-kpi-value { font-size: 32px; margin-top: 16px; }
  .db-banner { flex-wrap: wrap; padding: 16px; }
  .db-banner-action { margin-left: 56px; }
  .db-donut-wrap { flex-direction: column; align-items: stretch; }
  .db-donut { margin: 0 auto; }
  .db-faces { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px 10px; }
  .db-face-meta { display: none; }
  .db-hero-tile { padding: 22px; border-radius: 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .db *, .db *::before, .db *::after { animation: none !important; transition: none !important; }
}
`;