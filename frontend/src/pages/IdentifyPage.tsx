import { useState } from 'react';
import api from '../api/client';
import { cropUrl } from '../api/utils';
import { IdentifyResult } from '../types';
import AuthenticatedImage from '../components/AuthenticatedImage';

export default function IdentifyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFile = (f: File | null) => {
    setFile(f); setResult(null); setError('');
    if (f) { const r = new FileReader(); r.onload = e => setPreview(e.target?.result as string); r.readAsDataURL(f); }
    else setPreview(null);
  };

  const handleSearch = async () => {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    try { const form = new FormData(); form.append('image', file); const res = await api.post('/identify', form); setResult(res.data); }
    catch (err: any) { setError(err.response?.data?.detail || 'Identification failed'); }
    finally { setLoading(false); }
  };

  return (
    <div style={s.container}>
      <h1 style={s.title}>Identify Person</h1>
      <p style={s.desc}>Upload a photo of a person to find all their sightings across your footage.</p>
      <div style={s.uploadRow}>
        <div style={s.dropZone} onClick={() => document.getElementById('id-file')?.click()}>
          {preview ? <img src={preview} alt="" style={s.previewImg} /> : <div style={s.dropText}>Click to upload photo</div>}
          <input id="id-file" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0] || null)} />
        </div>
        <button onClick={handleSearch} disabled={!file || loading} style={s.searchBtn}>{loading ? 'Searching...' : '🔍 Search'}</button>
      </div>
      {error && <div style={s.error}>{error}</div>}
      {result && (
        <div>
          <div style={s.matchCard}>
            <h2 style={s.matchName}>{result.label || `Person #${result.person_id}`}</h2>
            <div style={s.matchStats}>
              <span style={s.simBadge}>{(result.similarity * 100).toFixed(1)}% match</span>
              <span>{result.total_sightings} sightings</span>
              <span>First: {result.first_seen ? new Date(result.first_seen).toLocaleString() : 'N/A'}</span>
              <span>Last: {result.last_seen ? new Date(result.last_seen).toLocaleString() : 'N/A'}</span>
            </div>
          </div>
          <h3 style={s.sightTitle}>Sighting History</h3>
          <div style={s.sGrid}>
            {result.sightings.map(si => (
              <div key={si.id} style={s.sCard}>
                {si.crop_url ? <AuthenticatedImage src={cropUrl(si.crop_url)} alt="" style={s.sImg} /> : <div style={s.sNoImg}>No crop</div>}
                <div style={s.sInfo}>
                  <div style={{ color: '#1e293b', fontSize: 13, fontWeight: 600 }}>{si.seen_at ? new Date(si.seen_at).toLocaleString() : ''}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>📹 {si.camera_id}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: 28, maxWidth: 900, margin: '0 auto' },
  title: { color: '#1e293b', marginBottom: 4, fontWeight: 700 },
  desc: { color: '#94a3b8', fontSize: 14, marginBottom: 20 },
  uploadRow: { display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 20 },
  dropZone: { width: 200, height: 200, background: '#fff', borderRadius: 12, border: '2px dashed #e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  dropText: { color: '#cbd5e1', fontSize: 13, textAlign: 'center', padding: 20 },
  previewImg: { width: '100%', height: '100%', objectFit: 'cover' },
  searchBtn: { padding: '12px 32px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 15, cursor: 'pointer', fontWeight: 600 },
  error: { background: '#fef2f2', color: '#dc2626', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14, border: '1px solid #fecaca' },
  matchCard: { background: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  matchName: { color: '#1e293b', margin: '0 0 12px', fontWeight: 700 },
  matchStats: { display: 'flex', gap: 20, color: '#64748b', fontSize: 14, flexWrap: 'wrap', alignItems: 'center' },
  simBadge: { background: '#ecfdf5', color: '#059669', padding: '3px 12px', borderRadius: 12, fontWeight: 600, fontSize: 13 },
  sightTitle: { color: '#1e293b', marginBottom: 12, fontWeight: 600 },
  sGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  sCard: { display: 'flex', background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  sImg: { width: 80, height: 80, objectFit: 'cover' },
  sNoImg: { width: 80, height: 80, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 11 },
  sInfo: { padding: 10 },
};
