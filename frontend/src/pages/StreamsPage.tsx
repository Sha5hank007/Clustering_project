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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAdmin && !shopId) {
      setError('Please select a shop');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body: any = { name, url, camera_id: cameraId };
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
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#475569', marginBottom: 4 }}>
                Shop *
              </label>
              <select
                value={shopId}
                onChange={e => setShopId(e.target.value ? Number(e.target.value) : '')}
                required
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #cbd5e1', fontSize: 14, background: '#fff'
                }}
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
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#475569', marginBottom: 4 }}>
                Stream Name
              </label>
              <input
                value={name} onChange={e => setName(e.target.value)} required
                placeholder="e.g. Front Door Camera"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#475569', marginBottom: 4 }}>
                Camera ID
              </label>
              <input
                value={cameraId} onChange={e => setCameraId(e.target.value)} required
                placeholder="e.g. cam-01"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box'
                }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#475569', marginBottom: 4 }}>
              Stream URL
            </label>
            <input
              value={url} onChange={e => setUrl(e.target.value)} required
              placeholder="rtsp://192.168.1.100:554/stream or webcam://0"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box'
              }}
            />
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
                  {s.camera_id} &middot; {s.url}
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

const btnStyle = (bg: string): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: bg, color: '#fff', fontWeight: 600,
  fontSize: 13, cursor: 'pointer'
});