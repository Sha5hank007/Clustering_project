import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Reveal from '../components/Reveal';

interface Shop {
  id: number;
  name: string;
}

interface Camera {
  id: number;
  camera_id: string;
  name: string;
  shop_id: number;
  is_active: boolean;
}

const CAMERA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const CameraIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" />
    <rect x="3" y="6" width="12" height="12" rx="2" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function CamerasPage() {
  const { user, isAdmin } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | ''>(user?.shop_id ?? '');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (isAdmin) {
      api.get('/admin/shops')
        .then(response => setShops(response.data.shops || []))
        .catch((err: any) => setError(err.response?.data?.detail || 'Unable to load shops'));
    }
  }, [isAdmin]);

  const loadCameras = async () => {
    if (isAdmin && !shopId) {
      setCameras([]);
      return;
    }
    try {
      const response = await api.get('/cameras', {
        params: { include_inactive: true, ...(isAdmin ? { shop_id: shopId } : {}) },
      });
      setCameras(response.data.cameras || []);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to load cameras');
    }
  };

  useEffect(() => {
    loadCameras();
  }, [isAdmin, shopId]);

  // Auto-dismiss the success toast
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  const resetForm = () => {
    setCameraId('');
    setName('');
    setFormError('');
  };

  const registerCamera = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setMessage('');

    if (isAdmin && !shopId) {
      setFormError('Please select a shop first');
      return;
    }
    if (!CAMERA_ID_PATTERN.test(cameraId.trim())) {
      setFormError('Camera ID must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens');
      return;
    }
    if (!name.trim()) {
      setFormError('Please enter a display name');
      return;
    }

    setLoading(true);
    try {
      await api.post('/cameras', {
        camera_id: cameraId.trim(),
        name: name.trim(),
        ...(isAdmin ? { shop_id: shopId } : {}),
      });
      resetForm();
      setFormOpen(false);
      setMessage('Camera registered');
      await loadCameras();
    } catch (err: any) {
      setFormError(err.response?.data?.detail || 'Unable to register camera');
    } finally {
      setLoading(false);
    }
  };

  const toggleCamera = async (camera: Camera) => {
    setError('');
    setMessage('');
    setBusyId(camera.id);
    try {
      await api.patch(`/cameras/${encodeURIComponent(camera.camera_id)}`, {
        is_active: !camera.is_active,
      }, {
        params: isAdmin ? { shop_id: shopId } : undefined,
      });
      setMessage(camera.is_active ? `${camera.name} deactivated` : `${camera.name} activated`);
      await loadCameras();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to update camera');
    } finally {
      setBusyId(null);
    }
  };

  const toggleForm = () => {
    if (formOpen) resetForm();
    setFormOpen(open => !open);
  };

  const needsShop = isAdmin && !shopId;
  const activeCount = cameras.filter(c => c.is_active).length;
  const inactiveCount = cameras.length - activeCount;
  const shopName = shops.find(s => s.id === shopId)?.name;

  const summary = needsShop
    ? 'Choose a shop to manage its cameras.'
    : cameras.length === 0
      ? 'Register the cameras you use for streams and uploads.'
      : [`${activeCount} active`, inactiveCount > 0 ? `${inactiveCount} inactive` : null]
          .filter(Boolean).join(' · ');

  return (
    <div className="cm">
      <style>{styles}</style>

      <Reveal className="cm-header">
        <div className="cm-header-text">
          <h1 className="cm-title">Cameras</h1>
          <p className="cm-subtitle">{summary}</p>
        </div>
        <div className="cm-header-controls">
          {isAdmin && (
            <label className="cm-shop">
              <span className="cm-visually-hidden">Shop</span>
              <select
                className="cm-input cm-input--compact"
                value={shopId}
                onChange={event => {
                  setShopId(event.target.value ? Number(event.target.value) : '');
                  setFormError('');
                }}
              >
                <option value="">Select a shop</option>
                {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
              </select>
            </label>
          )}
          <button
            type="button"
            className={formOpen ? 'cm-btn cm-btn--secondary' : 'cm-btn cm-btn--primary'}
            onClick={toggleForm}
            disabled={needsShop && !formOpen}
            aria-expanded={formOpen}
            aria-controls="cm-add-form"
          >
            {!formOpen && <PlusIcon />}
            {formOpen ? 'Cancel' : 'Add camera'}
          </button>
        </div>
      </Reveal>

      {error && <p className="cm-error cm-page-error" role="alert">{error}</p>}

      {formOpen && (
        <form id="cm-add-form" className="cm-form" onSubmit={registerCamera} noValidate>
          <h2 className="cm-form-title">
            New camera{shopName && <span className="cm-form-context"> in {shopName}</span>}
          </h2>
          <div className="cm-row">
            <label className="cm-field">
              <span className="cm-label">Camera ID</span>
              <input
                className="cm-input cm-input--mono"
                value={cameraId}
                onChange={event => setCameraId(event.target.value)}
                placeholder="cam-01"
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <span className="cm-hint">Letters, numbers, dots, dashes, or underscores. Unique within the shop.</span>
            </label>
            <label className="cm-field">
              <span className="cm-label">Display name</span>
              <input
                className="cm-input"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Front door"
              />
            </label>
          </div>

          {formError && <p className="cm-error" role="alert">{formError}</p>}

          <div>
            <button type="submit" disabled={loading} className="cm-btn cm-btn--primary">
              {loading && <span className="cm-spinner" aria-hidden="true" />}
              {loading ? 'Registering…' : 'Register camera'}
            </button>
          </div>
        </form>
      )}

      <Reveal delay={100}>
        {needsShop ? (
          <div className="cm-empty">
            <span className="cm-empty-icon"><CameraIcon size={22} /></span>
            <p className="cm-empty-title">No shop selected</p>
            <p className="cm-empty-text">Pick a shop above to see and manage its cameras.</p>
          </div>
        ) : cameras.length === 0 ? (
          !formOpen && (
            <div className="cm-empty">
              <span className="cm-empty-icon"><CameraIcon size={22} /></span>
              <p className="cm-empty-title">No cameras yet</p>
              <p className="cm-empty-text">Register a camera, then pick it when adding a stream or uploading video.</p>
              <button type="button" className="cm-btn cm-btn--primary" onClick={() => setFormOpen(true)}>
                <PlusIcon /> Add your first camera
              </button>
            </div>
          )
        ) : (
          <>
            <ul className="cm-list" aria-label="Registered cameras">
              {cameras.map((camera, index) => {
                const busy = busyId === camera.id;
                return (
                  <li
                    key={camera.id}
                    className={`cm-item${camera.is_active ? '' : ' is-inactive'}`}
                    style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
                  >
                    <span className="cm-tile"><CameraIcon /></span>
                    <div className="cm-main">
                      <span className="cm-name">{camera.name}</span>
                      <span className="cm-id">{camera.camera_id}</span>
                    </div>
                    <span className={`cm-status${camera.is_active ? ' is-on' : ''}`}>
                      {camera.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={camera.is_active}
                      aria-label={`${camera.is_active ? 'Deactivate' : 'Activate'} ${camera.name}`}
                      className={`cm-switch${camera.is_active ? ' is-on' : ''}${busy ? ' is-busy' : ''}`}
                      onClick={() => toggleCamera(camera)}
                      disabled={busy}
                    >
                      <span className="cm-switch-knob" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="cm-footnote">Turning a camera off hides it from new streams and uploads. Its past sightings are kept.</p>
          </>
        )}
      </Reveal>

      {message && (
        <div className="cm-toast" role="status" key={message}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          {message}
        </div>
      )}
    </div>
  );
}

const styles = `
.cm {
  --cm-text: #1d1d1f;
  --cm-muted: #6e6e73;
  --cm-faint: #86868b;
  --cm-line: rgba(0, 0, 0, 0.08);
  --cm-soft: rgba(0, 0, 0, 0.04);
  --cm-softer: rgba(0, 0, 0, 0.07);
  --cm-accent: #0071e3;
  --cm-accent-hover: #0077ed;
  --cm-green: #34c759;
  --cm-red: #e30000;
  --cm-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  max-width: 880px;
  margin: 0 auto;
  padding: 56px 24px 112px;
  color: var(--cm-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.cm-visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
}

/* Header */
.cm-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px 24px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--cm-line);
}
.cm-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}
.cm-subtitle { margin: 8px 0 0; font-size: 17px; color: var(--cm-muted); font-variant-numeric: tabular-nums; }
.cm-header-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cm-shop { min-width: 200px; }

/* Buttons */
.cm-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: 980px;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s var(--cm-ease), transform 0.2s var(--cm-ease);
}
.cm-btn:active:not(:disabled) { transform: scale(0.97); }
.cm-btn:disabled { opacity: 0.45; cursor: default; }
.cm-btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.3); }
.cm-btn--primary { background: var(--cm-accent); color: #fff; }
.cm-btn--primary:hover:not(:disabled) { background: var(--cm-accent-hover); }
.cm-btn--secondary { background: var(--cm-soft); color: var(--cm-text); }
.cm-btn--secondary:hover { background: var(--cm-softer); }
.cm-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: cm-spin 0.8s linear infinite;
}
@keyframes cm-spin { to { transform: rotate(360deg); } }

/* Inputs */
.cm-input {
  width: 100%;
  box-sizing: border-box;
  height: 48px;
  padding: 0 14px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 12px;
  background: #fff;
  color: var(--cm-text);
  font: inherit;
  font-size: 17px;
  transition: border-color 0.2s var(--cm-ease), box-shadow 0.2s var(--cm-ease);
}
.cm-input--compact { height: 40px; font-size: 15px; border-radius: 980px; padding-left: 16px; }
.cm-input--mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 15px; }
.cm-input::placeholder { color: #aeaeb2; }
select.cm-input {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 40px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%236e6e73' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
  cursor: pointer;
}
.cm-input:hover { border-color: rgba(0, 0, 0, 0.28); }
.cm-input:focus { outline: none; border-color: var(--cm-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }

/* Form */
.cm-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 36px 0 44px;
  border-bottom: 1px solid var(--cm-line);
  animation: cm-drop 0.45s var(--cm-ease);
}
@keyframes cm-drop { from { opacity: 0; transform: translateY(-10px); } }
.cm-form-title { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
.cm-form-context { font-weight: 400; color: var(--cm-muted); }
.cm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.cm-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cm-label { font-size: 14px; font-weight: 500; color: var(--cm-muted); }
.cm-hint { font-size: 13px; color: var(--cm-faint); line-height: 1.4; }
.cm-error { margin: 0; font-size: 15px; color: var(--cm-red); line-height: 1.5; }
.cm-page-error { padding-top: 20px; }

/* List */
.cm-list { list-style: none; margin: 0; padding: 0; }
.cm-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 0;
  border-bottom: 1px solid var(--cm-line);
  animation: cm-rise 0.5s var(--cm-ease) both;
}
@keyframes cm-rise { from { opacity: 0; transform: translateY(8px); } }
.cm-tile {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(52, 199, 89, 0.12);
  color: #1f9e45;
  flex-shrink: 0;
  transition: background 0.35s var(--cm-ease), color 0.35s var(--cm-ease);
}
.cm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cm-name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.35s var(--cm-ease);
}
.cm-id {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  color: var(--cm-faint);
}
.cm-status { font-size: 14px; color: var(--cm-faint); transition: color 0.35s var(--cm-ease); }
.cm-status.is-on { color: #1f9e45; }

.cm-item.is-inactive .cm-tile { background: var(--cm-soft); color: #aeaeb2; }
.cm-item.is-inactive .cm-name { color: var(--cm-muted); }

/* iOS-style switch */
.cm-switch {
  position: relative;
  width: 51px;
  height: 31px;
  padding: 0;
  border: none;
  border-radius: 31px;
  background: #e9e9eb;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.3s var(--cm-ease);
}
.cm-switch.is-on { background: var(--cm-green); }
.cm-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.06);
  transition: transform 0.35s cubic-bezier(0.3, 1.25, 0.5, 1), width 0.2s var(--cm-ease);
}
.cm-switch.is-on .cm-switch-knob { transform: translateX(20px); }
.cm-switch:active:not(:disabled) .cm-switch-knob { width: 33px; }
.cm-switch.is-on:active:not(:disabled) .cm-switch-knob { transform: translateX(14px); }
.cm-switch:disabled { cursor: default; }
.cm-switch.is-busy { opacity: 0.6; }
.cm-switch:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.4); }

.cm-footnote { margin: 20px 0 0; font-size: 13px; color: var(--cm-faint); }

/* Empty state */
.cm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 96px 24px;
}
.cm-empty-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--cm-soft);
  color: var(--cm-muted);
  margin-bottom: 18px;
}
.cm-empty-title { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
.cm-empty-text { margin: 8px 0 24px; max-width: 360px; font-size: 17px; color: var(--cm-muted); line-height: 1.45; }
.cm-empty-text:last-child { margin-bottom: 0; }

/* Toast */
.cm-toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 980px;
  background: rgba(29, 29, 31, 0.9);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  color: #fff;
  font-size: 15px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  transform: translateX(-50%);
  animation: cm-toast 3s var(--cm-ease) both;
}
.cm-toast svg { color: var(--cm-green); }
@keyframes cm-toast {
  0% { opacity: 0; transform: translate(-50%, 16px) scale(0.96); }
  10%, 85% { opacity: 1; transform: translate(-50%, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, 8px) scale(0.98); }
}

/* Responsive */
@media (max-width: 720px) {
  .cm { padding: 40px 16px 80px; }
  .cm-header-controls { width: 100%; }
  .cm-shop { flex: 1; min-width: 0; }
  .cm-row { grid-template-columns: 1fr; }
  .cm-status { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .cm *, .cm *::after { animation: none !important; transition: none !important; }
}
`;