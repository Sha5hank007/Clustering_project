import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../api/client';
import { cropUrl } from '../api/utils';
import { Person } from '../types';
import AuthenticatedImage from '../components/AuthenticatedImage';

export default function PersonsPage() {
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get('job_id');
  const [persons, setPersons] = useState<Person[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const params: any = { page, limit: 12 };
    if (jobId) params.job_id = jobId;
    api.get('/persons', { params }).then(r => { setPersons(r.data.persons); setTotalPages(r.data.total_pages); setTotal(r.data.total); });
  }, [page, jobId]);

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h1 style={s.title}>{jobId ? 'Persons from Video' : 'All Persons'}</h1>
        <span style={s.count}>{total} found</span>
      </div>
      {persons.length === 0 ? (
        <div style={s.empty}><p>No persons found.</p>{!jobId && <p><Link to="/ingest" style={s.link}>Upload a video</Link> to get started.</p>}</div>
      ) : (
        <div style={s.grid}>
          {persons.map(p => (
            <Link to={`/persons/${p.id}${jobId ? `?job_id=${jobId}` : ''}`} key={p.id} style={s.card}>
              {p.latest_crop_url ? <AuthenticatedImage src={cropUrl(p.latest_crop_url)} alt="" style={s.img} /> : <div style={s.noImg}>No image</div>}
              <div style={s.info}>
                <div style={s.name}>{p.label || `Person #${p.id}`}</div>
                <div style={s.meta}>{p.sighting_count} sightings</div>
                <div style={s.meta}>{p.last_seen ? new Date(p.last_seen).toLocaleDateString() : ''}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div style={s.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={s.pageBtn}>← Prev</button>
          <span style={s.pageInfo}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={s.pageBtn}>Next →</button>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: 28, maxWidth: 1100, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 },
  title: { color: '#1e293b', margin: 0, fontWeight: 700 },
  count: { color: '#94a3b8', fontSize: 14 },
  empty: { color: '#94a3b8', background: '#fff', padding: 40, borderRadius: 12, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  link: { color: '#2563eb' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 },
  card: { background: '#fff', borderRadius: 12, overflow: 'hidden', textDecoration: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'box-shadow 0.2s' },
  img: { width: '100%', height: 170, objectFit: 'cover' },
  noImg: { width: '100%', height: 170, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 13 },
  info: { padding: 12 },
  name: { color: '#1e293b', fontWeight: 600, fontSize: 14, marginBottom: 4 },
  meta: { color: '#94a3b8', fontSize: 12 },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 28 },
  pageBtn: { padding: '8px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  pageInfo: { color: '#94a3b8', fontSize: 13 },
};
