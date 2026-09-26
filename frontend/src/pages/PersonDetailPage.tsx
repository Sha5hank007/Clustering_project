import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { cropUrl } from '../api/utils';
import { useAuth } from '../context/AuthContext';
import AuthenticatedImage from '../components/AuthenticatedImage';

export default function PersonDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get('job_id');
  const { isAdmin, isManager } = useAuth();
  const [person, setPerson] = useState<any>(null);
  const [label, setLabel] = useState('');
  const [page, setPage] = useState(1);

  const load = () => {
    const params: any = { page, limit: 20 };
    if (jobId) params.job_id = jobId;
    api.get(`/persons/${id}`, { params }).then(r => { setPerson(r.data); setLabel(r.data.label || ''); });
  };
  useEffect(load, [id, page, jobId]);

  const saveLabel = async () => { await api.patch(`/persons/${id}/label`, { label: label || null }); load(); };

  if (!person) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h1 style={s.title}>{person.label || `Person #${person.id}`}</h1>
        <div style={s.badges}>
          <span style={s.badge}>{person.sighting_count} sightings</span>
          <span style={s.badge}>{person.embedding_count} embeddings</span>
        </div>
        <div style={s.dates}>First: {person.first_seen ? new Date(person.first_seen).toLocaleString() : 'N/A'} • Last: {person.last_seen ? new Date(person.last_seen).toLocaleString() : 'N/A'}</div>
      </div>
      {(isAdmin || isManager) && (
        <div style={s.labelRow}>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Assign a name..." style={s.labelInput} />
          <button onClick={saveLabel} style={s.labelBtn}>Save</button>
        </div>
      )}
      <h2 style={s.subtitle}>Sightings <span style={s.pageLabel}>— page {page} of {person.sightings_total_pages || 1}</span></h2>
      <div style={s.list}>
        {person.sightings?.map((si: any) => (
          <div key={si.id} style={s.sCard}>
            {si.crop_url ? <AuthenticatedImage src={cropUrl(si.crop_url)} alt="" style={s.sImg} /> : <div style={s.sNoImg}>No crop</div>}
            <div style={s.sInfo}>
              <div style={s.sTime}>{si.seen_at ? new Date(si.seen_at).toLocaleString() : 'Unknown'}</div>
              <div style={s.sMeta}>📹 {si.camera_id}</div>
              {si.quality_score && <div style={s.sMeta}>Quality: {si.quality_score.toFixed(2)}</div>}
            </div>
          </div>
        ))}
      </div>
      {(person.sightings_total_pages || 1) > 1 && (
        <div style={s.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={s.pageBtn}>← Prev</button>
          <span style={s.pageInfo}>Page {page} of {person.sightings_total_pages}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page >= person.sightings_total_pages} style={s.pageBtn}>Next →</button>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: 28, maxWidth: 1000, margin: '0 auto' },
  header: { marginBottom: 24 },
  title: { color: '#1e293b', margin: 0, fontSize: 24, fontWeight: 700 },
  badges: { display: 'flex', gap: 8, marginTop: 8 },
  badge: { background: '#f1f5f9', color: '#475569', padding: '4px 12px', borderRadius: 16, fontSize: 13 },
  dates: { color: '#94a3b8', fontSize: 13, marginTop: 8 },
  labelRow: { display: 'flex', gap: 8, marginBottom: 24, maxWidth: 400 },
  labelInput: { flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', fontSize: 14, outline: 'none' },
  labelBtn: { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  subtitle: { color: '#1e293b', marginBottom: 16, fontSize: 18, fontWeight: 600 },
  pageLabel: { color: '#94a3b8', fontSize: 14, fontWeight: 400 },
  list: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  sCard: { display: 'flex', background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  sImg: { width: 90, height: 90, objectFit: 'cover' },
  sNoImg: { width: 90, height: 90, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 11 },
  sInfo: { padding: 12, flex: 1 },
  sTime: { color: '#1e293b', fontSize: 13, fontWeight: 600, marginBottom: 4 },
  sMeta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 28 },
  pageBtn: { padding: '8px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer' },
  pageInfo: { color: '#94a3b8', fontSize: 13 },
};
