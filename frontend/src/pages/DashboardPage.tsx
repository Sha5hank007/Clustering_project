import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { Stats } from '../types';
import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { api.get('/stats').then(r => setStats(r.data)); }, []);

  if (!stats) return <div style={s.loading}>Loading...</div>;

  return (
    <div style={s.container}>
      <div style={s.welcome}>
        <h1 style={s.title}>Dashboard</h1>
        <p style={s.subtitle}>Welcome back, {user?.email}</p>
      </div>
      <div style={s.grid}>
        <Card label="Persons" value={stats.total_persons} icon="👤" link="/persons" color="#2563eb" />
        <Card label="Sightings" value={stats.total_sightings} icon="👁" color="#7c3aed" />
        <Card label="Active Streams" value={stats.active_streams} icon="📹" link="/streams" color="#059669" />
        <Card label="Processing" value={stats.pending_jobs} icon="⚙️" link="/ingest" color="#d97706" />
        <Card label="Cameras" value={stats.cameras.length} icon="🎥" color="#0891b2" />
        <Card label="Saved Crops" value={stats.total_crops_on_disk} icon="🖼" color="#e11d48" />
      </div>
      <div style={s.infoRow}>
        <div style={s.infoCard}>
          <h3 style={s.infoTitle}>Cameras</h3>
          {stats.cameras.length > 0 ? (
            <div style={s.tags}>{stats.cameras.map(c => <span key={c} style={s.tag}>{c}</span>)}</div>
          ) : <p style={s.noData}>No cameras yet. <Link to="/ingest" style={s.link}>Upload a video</Link> to start.</p>}
        </div>
        <div style={s.infoCard}>
          <h3 style={s.infoTitle}>Activity</h3>
          <p style={s.infoText}>First: {stats.first_sighting ? new Date(stats.first_sighting).toLocaleString() : 'N/A'}</p>
          <p style={s.infoText}>Last: {stats.last_sighting ? new Date(stats.last_sighting).toLocaleString() : 'N/A'}</p>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, icon, link, color }: { label: string; value: string | number; icon: string; link?: string; color: string }) {
  const c = (
    <div style={{ ...s.card, borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><div style={s.cardValue}>{value}</div><div style={s.cardLabel}>{label}</div></div>
        <div style={{ fontSize: 32, opacity: 0.3 }}>{icon}</div>
      </div>
    </div>
  );
  return link ? <Link to={link} style={{ textDecoration: 'none' }}>{c}</Link> : c;
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: 28, maxWidth: 1100, margin: '0 auto' },
  loading: { padding: 60, textAlign: 'center', color: '#94a3b8' },
  welcome: { marginBottom: 24 },
  title: { color: '#1e293b', margin: 0, fontSize: 26, fontWeight: 700 },
  subtitle: { color: '#94a3b8', margin: '4px 0 0', fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 24 },
  card: { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  cardValue: { fontSize: 28, fontWeight: 700, color: '#1e293b' },
  cardLabel: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  infoRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  infoCard: { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  infoTitle: { color: '#1e293b', margin: '0 0 12px', fontSize: 15, fontWeight: 600 },
  infoText: { color: '#64748b', margin: '4px 0', fontSize: 14 },
  link: { color: '#2563eb', textDecoration: 'none' },
  noData: { color: '#94a3b8', fontSize: 14, margin: 0 },
  tags: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tag: { background: '#f1f5f9', color: '#475569', padding: '4px 12px', borderRadius: 16, fontSize: 13 },
};
