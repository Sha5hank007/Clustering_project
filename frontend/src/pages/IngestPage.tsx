import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { IngestJob } from '../types';

interface Shop {
  id: number;
  name: string;
}

function localDateTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export default function IngestPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [file, setFile] = useState<File | null>(null);
  const [cameraId, setCameraId] = useState('');
  const [recordedAt, setRecordedAt] = useState(localDateTime);
  const [shopId, setShopId] = useState<number | ''>('');
  const [shops, setShops] = useState<Shop[]>([]);
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<IngestJob | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [shopError, setShopError] = useState('');

  const fetchJobs = async (requestedPage = page) => {
    try {
      const response = await api.get('/ingest/jobs', { params: { page: requestedPage, limit: 10 } });
      setJobs(response.data.jobs || []);
      setTotalPages(response.data.total_pages || 0);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to load upload jobs');
    }
  };

  const selectJob = async (jobId: string) => {
    try {
      const response = await api.get(`/ingest/status/${jobId}`);
      setSelectedJob(response.data);
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

    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('video', file);
    form.append('camera_id', cameraId);
    form.append('recorded_at', new Date(recordedAt).toISOString());
    if (isAdmin) form.append('shop_id', String(shopId));

    try {
      await api.post('/ingest', form);
      setFile(null);
      setCameraId('');
      setRecordedAt(localDateTime());
      setShopId('');
      const input = document.getElementById('video-file') as HTMLInputElement | null;
      if (input) input.value = '';
      setPage(1);
      await fetchJobs(1);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Upload Video</h1>
      <form onSubmit={handleUpload} style={styles.form}>
        <label style={styles.label}>Video file
          <input id="video-file" type="file" accept="video/*" required onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        <div style={styles.grid}>
          <label style={styles.label}>Camera ID
            <input value={cameraId} onChange={e => setCameraId(e.target.value)} placeholder="cam-01" required style={styles.input} />
          </label>
          <label style={styles.label}>Recorded at
            <input type="datetime-local" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} required style={styles.input} />
          </label>
        </div>
        {isAdmin && <label style={styles.label}>Shop
          <select value={shopId} onChange={e => setShopId(e.target.value ? Number(e.target.value) : '')} required style={styles.input}>
            <option value="">Select a shop...</option>
            {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
          {shopError && <span style={styles.shopError}>{shopError}</span>}
        </label>}
        {error && <div style={styles.error}>{error}</div>}
        <button type="submit" disabled={uploading} style={styles.button}>{uploading ? 'Uploading...' : 'Upload video'}</button>
      </form>

      <h2 style={styles.heading}>Upload jobs</h2>
      {selectedJob && <div style={styles.details}>
        <strong>{selectedJob.original_name}</strong>
        <div style={styles.detailGrid}>
          <span>Status: {selectedJob.status}</span>
          <span>Camera: {selectedJob.camera_id}</span>
          <span>Recorded: {selectedJob.recorded_at ? new Date(selectedJob.recorded_at).toLocaleString() : 'N/A'}</span>
          <span>Frames: {selectedJob.processed_frame ?? 0} / {selectedJob.total_frames ?? 'N/A'}</span>
          <span>Persons: {selectedJob.persons_found}</span>
          <span>Sightings: {selectedJob.sightings_added}</span>
        </div>
        {selectedJob.error && <div style={styles.error}>{selectedJob.error}</div>}
      </div>}
      {jobs.length === 0 ? <p style={styles.muted}>No upload jobs yet.</p> : jobs.map(job => (
        <button key={job.job_id} type="button" onClick={() => selectJob(job.job_id)} style={styles.jobButton}>
          <div style={styles.job}><div><strong>{job.original_name}</strong><div style={styles.muted}>{job.camera_id} · {job.status}</div></div><div style={styles.progress}>{job.progress_percent.toFixed(1)}%</div></div>
        </button>
      ))}
      {totalPages > 1 && <div style={styles.pagination}>
        <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1} style={styles.pageButton}>Previous</button>
        <span style={styles.muted}>Page {page} of {totalPages}</span>
        <button type="button" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page === totalPages} style={styles.pageButton}>Next</button>
      </div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 900, margin: '0 auto', padding: 28 },
  title: { color: '#0f172a', marginBottom: 20 },
  heading: { color: '#0f172a', marginTop: 32, fontSize: 20 },
  form: { background: '#fff', padding: 24, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, color: '#475569', fontSize: 14, fontWeight: 600 },
  input: { width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, fontWeight: 400 },
  button: { alignSelf: 'flex-start', padding: '10px 22px', border: 'none', borderRadius: 8, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  error: { color: '#b91c1c', background: '#fef2f2', padding: 10, borderRadius: 8, fontSize: 14 },
  shopError: { color: '#b91c1c', fontSize: 13, fontWeight: 400 },
  job: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: 16, marginBottom: 10, borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  jobButton: { display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' },
  details: { background: '#eff6ff', border: '1px solid #bfdbfe', padding: 16, margin: '16px 0', borderRadius: 10, color: '#1e3a8a' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 10, fontSize: 13 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 18 },
  pageButton: { padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#475569', cursor: 'pointer' },
  progress: { color: '#2563eb', fontWeight: 700 },
  muted: { color: '#64748b', fontSize: 13, marginTop: 4 },
};
