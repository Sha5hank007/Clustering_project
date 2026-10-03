import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

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

export default function StreamsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [streams, setStreams] = useState<Stream[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [shopId, setShopId] = useState<number | ''>('');
  const [sourceType, setSourceType] = useState<'rtsp' | 'webcam' | 'youtube'>('rtsp');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shopError, setShopError] = useState('');

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

  useEffect(() => {
    fetchStreams();
    if (isAdmin) fetchShops();
    const interval = setInterval(fetchStreams, 10000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const getPlaceholder = () => {
    switch (sourceType) {
      case 'rtsp': return 'rtsp://192.168.1.100:554/stream';
      case 'webcam': return 'webcam://0';
      case 'youtube': return 'https://www.youtube.com/live/...';
    }
  };

  const buildUrl = (): string => {
    const trimmed = url.trim();
    if (sourceType === 'webcam') {
      const num = trimmed.replace(/\D/g, '') || '0';
      return `webcam://${num}`;
    }
    return trimmed;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAdmin && !shopId) {
      setError('Please select a shop');
      return;
    }
    if (!url.trim()) {
      setError('Please enter a stream URL');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body: any = { name, url: buildUrl(), camera_id: cameraId };
      if (isAdmin && shopId) body.shop_id = shopId;
      await api.post('/streams', body);
      setName(''); setUrl(''); setCameraId(''); setShopId('');
      fetchStreams();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to add stream');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: string, action: string) => {
    try {
      if (action === 'delete') {
        await api.delete(`/streams/${id}`);
      } else {
        await api.patch(`/streams/${id}/${action}`);
      }
      fetchStreams();
    } catch (err: any) {
      alert(err.response?.data?.detail || `Failed to ${action}`);
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'running': return '#16a34a';
      case 'paused': return '#d97706';
      case 'stopped': return '#dc2626';
      default: return '#64748b';
    }
  };

  const sourceIcon = (url: string) => {
    if (url.startsWith('webcam://')) return '📷';
    if (url.startsWith('rtsp://')) return '📹';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return '▶️';
    return '🔗';
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>
        Live Streams
      </h1>

      {/* Add Stream Form */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 32
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', marginBottom: 16 }}>
          Add Stream
        </h2>
        <form onSubmit={handleAdd}>
          {isAdmin && (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Shop *</label>
              <select
                value={shopId}
                onChange={e => setShopId(e.target.value ? Number(e.target.value) : '')}
                required
                style={selectStyle}
              >
                <option value="">Select a shop...</option>
                {shops.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {shopError && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 4 }}>{shopError}</div>}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Stream Name</label>
              <input
                value={name} onChange={e => setName(e.target.value)} required
                placeholder="e.g. Front Door Camera"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Camera ID</label>
              <input
                value={cameraId} onChange={e => setCameraId(e.target.value)} required
                placeholder="e.g. cam-01"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Source Type Selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Source Type</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {([
                { key: 'rtsp', label: '📹 RTSP Camera' },
                { key: 'webcam', label: '📷 Webcam' },
                { key: 'youtube', label: '▶️ YouTube Live' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => { setSourceType(opt.key); setUrl(''); }}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: sourceType === opt.key ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: sourceType === opt.key ? '#eff6ff' : '#fff',
                    color: sourceType === opt.key ? '#2563eb' : '#475569',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              {sourceType === 'webcam' ? 'Device Number' : 'Stream URL'}
            </label>
            <input
              value={url} onChange={e => setUrl(e.target.value)} required
              placeholder={getPlaceholder()}
              style={inputStyle}
            />
            {sourceType === 'youtube' && (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>
                Only YouTube Live streams are supported (not regular videos). Requires yt-dlp configured on the server.
              </p>
            )}
            {sourceType === 'webcam' && (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>
                Enter device number (e.g. 0 for default camera). Opens camera on the machine running the stream worker.
              </p>
            )}
          </div>
          {error && <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error}</p>}
          <button
            type="submit" disabled={loading}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: '#2563eb', color: '#fff', fontWeight: 600,
              fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? 'Adding...' : 'Add Stream'}
          </button>
        </form>
      </div>

      {/* Stream List */}
      {streams.length === 0 ? (
        <p style={{ color: '#64748b', textAlign: 'center', padding: 48 }}>
          No streams yet. Add one above to get started.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {streams.map(s => (
            <div key={s.stream_id} style={{
              background: '#fff', borderRadius: 12, padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>{sourceIcon(s.url)}</span>
                  <span style={{ fontWeight: 600, fontSize: 16, color: '#0f172a' }}>{s.name}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: '#fff',
                    background: statusColor(s.status), padding: '2px 10px',
                    borderRadius: 12, textTransform: 'uppercase'
                  }}>
                    {s.status}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                  {s.camera_id} &middot; {s.url.length > 60 ? s.url.substring(0, 60) + '...' : s.url}
                </p>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  {s.persons_found} persons &middot; {s.sightings_added} sightings
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {s.status === 'running' && (
                  <button onClick={() => handleAction(s.stream_id, 'pause')} style={btnStyle('#d97706')}>
                    Pause
                  </button>
                )}
                {s.status === 'paused' && (
                  <button onClick={() => handleAction(s.stream_id, 'resume')} style={btnStyle('#16a34a')}>
                    Resume
                  </button>
                )}
                {s.status !== 'stopped' && (
                  <button onClick={() => handleAction(s.stream_id, 'stop')} style={btnStyle('#dc2626')}>
                    Stop
                  </button>
                )}
                <button onClick={() => handleAction(s.stream_id, 'delete')} style={btnStyle('#64748b')}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 14, fontWeight: 500, color: '#475569', marginBottom: 4
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box'
};

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid #cbd5e1', fontSize: 14, background: '#fff'
};

const btnStyle = (bg: string): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: bg, color: '#fff', fontWeight: 600,
  fontSize: 13, cursor: 'pointer'
});