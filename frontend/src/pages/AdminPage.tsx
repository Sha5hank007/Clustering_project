import { useEffect, useState } from 'react';
import api from '../api/client';
import { Shop, User } from '../types';
import { useAuth } from '../context/AuthContext';
import Reveal from '../components/Reveal';

type Tab = 'users' | 'shops';
type ShopRow = Shop & { address?: string | null };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);

const StoreIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5" />
    <path d="M3 9.5L4.6 4.7A1 1 0 0 1 5.55 4h12.9a1 1 0 0 1 .95.7L21 9.5a2.75 2.75 0 0 1-5.5 0 2.75 2.75 0 0 1-5.5 0 2.75 2.75 0 0 1-5.5 0" />
    <path d="M10 20v-5h4v5" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export default function AdminPage() {
  const { isAdmin, user: currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [shopName, setShopName] = useState('');
  const [shopAddr, setShopAddr] = useState('');
  const [shopFormOpen, setShopFormOpen] = useState(false);
  const [shopError, setShopError] = useState('');
  const [shopSaving, setShopSaving] = useState(false);

  const [userEmail, setUserEmail] = useState('');
  const [userPass, setUserPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [userRole, setUserRole] = useState('guard');
  const [userShop, setUserShop] = useState('');
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [userError, setUserError] = useState('');
  const [userSaving, setUserSaving] = useState(false);

  const [query, setQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [listError, setListError] = useState('');
  const [toast, setToast] = useState('');

  const loadShops = () => api.get('/admin/shops').then(r => setShops(r.data.shops || [])).catch(() => {});
  const loadUsers = () => api.get('/admin/users').then(r => setUsers(r.data.users || [])).catch(() => {});
  useEffect(() => { loadShops(); loadUsers(); }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const resetShopForm = () => { setShopName(''); setShopAddr(''); setShopError(''); };
  const resetUserForm = () => {
    setUserEmail(''); setUserPass(''); setShowPass(false); setUserRole('guard'); setUserShop(''); setUserError('');
  };

  const createShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopName.trim()) { setShopError('Please enter a shop name'); return; }
    setShopSaving(true);
    setShopError('');
    try {
      await api.post('/admin/shops', { name: shopName.trim(), address: shopAddr.trim() || null });
      resetShopForm();
      setShopFormOpen(false);
      setToast('Shop created');
      loadShops();
    } catch (err: any) {
      setShopError(err.response?.data?.detail || 'Unable to create shop');
    } finally {
      setShopSaving(false);
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(userEmail.trim())) { setUserError('Please enter a valid email address'); return; }
    if (!userPass) { setUserError('Please enter a password'); return; }
    if (userRole !== 'admin' && !userShop) { setUserError('Please select a shop for this user'); return; }
    setUserSaving(true);
    setUserError('');
    try {
      await api.post('/admin/users', {
        email: userEmail.trim(),
        password: userPass,
        role: userRole,
        shop_id: userRole === 'admin' ? null : parseInt(userShop),
      });
      resetUserForm();
      setUserFormOpen(false);
      setToast('User created');
      loadUsers();
    } catch (err: any) {
      setUserError(err.response?.data?.detail || 'Unable to create user');
    } finally {
      setUserSaving(false);
    }
  };

  const deleteUser = async (id: number) => {
    setDeletingId(id);
    setListError('');
    try {
      await api.delete(`/admin/users/${id}`);
      setConfirmDeleteId(null);
      setToast('User deleted');
      loadUsers();
    } catch (err: any) {
      setListError(err.response?.data?.detail || 'Unable to delete user');
    } finally {
      setDeletingId(null);
    }
  };

  const roles = ['guard', 'manager', ...(isAdmin ? ['admin'] : [])];
  const roleIndex = Math.max(0, roles.indexOf(userRole));
  const tabs: Tab[] = ['users', 'shops'];
  const tabIndex = tabs.indexOf(tab);

  const q = query.trim().toLowerCase();
  const filteredUsers = q
    ? users.filter(u =>
        u.email.toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q) ||
        (u.shop_name || '').toLowerCase().includes(q))
    : users;

  const activeTab: Tab = isAdmin ? tab : 'users';

  return (
    <div className="ad">
      <style>{styles}</style>

      <Reveal className="ad-header">
        <div>
          <h1 className="ad-title">Admin</h1>
          <p className="ad-subtitle">
            {users.length} {users.length === 1 ? 'user' : 'users'}
            {isAdmin && <> · {shops.length} {shops.length === 1 ? 'shop' : 'shops'}</>}
          </p>
        </div>
        {isAdmin && (
          <div className="ad-segmented" role="tablist" aria-label="Admin sections">
            <span
              className="ad-segmented-thumb"
              style={{ width: `calc((100% - 4px) / ${tabs.length})`, transform: `translateX(${tabIndex * 100}%)` }}
              aria-hidden="true"
            />
            {tabs.map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`ad-segment${tab === t ? ' is-active' : ''}`}
                onClick={() => { setTab(t); setConfirmDeleteId(null); }}
              >
                {capitalize(t)}
              </button>
            ))}
          </div>
        )}
      </Reveal>

      {activeTab === 'users' && (
        <section key="users" className="ad-panel" aria-labelledby="ad-users-title">
          <div className="ad-section-head">
            <h2 className="ad-section-title" id="ad-users-title">Users</h2>
            <div className="ad-section-tools">
              {users.length > 0 && !userFormOpen && (
                <label className="ad-search">
                  <SearchIcon />
                  <span className="ad-visually-hidden">Search users</span>
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" />
                </label>
              )}
              <button
                type="button"
                className={userFormOpen ? 'ad-btn ad-btn--secondary' : 'ad-btn ad-btn--primary'}
                onClick={() => { if (userFormOpen) resetUserForm(); setUserFormOpen(o => !o); }}
                aria-expanded={userFormOpen}
              >
                {!userFormOpen && <PlusIcon />}
                {userFormOpen ? 'Cancel' : 'Add user'}
              </button>
            </div>
          </div>

          {userFormOpen && (
            <form className="ad-form" onSubmit={createUser} noValidate>
              <div className="ad-row">
                <label className="ad-field">
                  <span className="ad-label">Email</span>
                  <input
                    className="ad-input"
                    type="email"
                    value={userEmail}
                    onChange={e => setUserEmail(e.target.value)}
                    placeholder="name@company.com"
                    autoComplete="off"
                    autoFocus
                  />
                </label>
                <label className="ad-field">
                  <span className="ad-label">Password</span>
                  <span className="ad-password">
                    <input
                      className="ad-input"
                      type={showPass ? 'text' : 'password'}
                      value={userPass}
                      onChange={e => setUserPass(e.target.value)}
                      autoComplete="new-password"
                    />
                    <button type="button" className="ad-reveal" onClick={() => setShowPass(v => !v)}>
                      {showPass ? 'Hide' : 'Show'}
                    </button>
                  </span>
                </label>
              </div>

              <div className="ad-field">
                <span className="ad-label" id="ad-role-label">Role</span>
                <div className="ad-segmented ad-segmented--wide" role="radiogroup" aria-labelledby="ad-role-label">
                  <span
                    className="ad-segmented-thumb"
                    style={{ width: `calc((100% - 4px) / ${roles.length})`, transform: `translateX(${roleIndex * 100}%)` }}
                    aria-hidden="true"
                  />
                  {roles.map(r => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={userRole === r}
                      className={`ad-segment${userRole === r ? ' is-active' : ''}`}
                      onClick={() => setUserRole(r)}
                    >
                      {capitalize(r)}
                    </button>
                  ))}
                </div>
              </div>

              {userRole !== 'admin' ? (
                <label className="ad-field ad-appear">
                  <span className="ad-label">Shop</span>
                  <select className="ad-input ad-select" value={userShop} onChange={e => setUserShop(e.target.value)}>
                    <option value="">Select a shop</option>
                    {shops.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                  </select>
                </label>
              ) : (
                <p className="ad-note ad-appear">Admins have access to every shop.</p>
              )}

              {userError && <p className="ad-error" role="alert">{userError}</p>}

              <div>
                <button type="submit" className="ad-btn ad-btn--primary ad-btn--lg" disabled={userSaving}>
                  {userSaving && <span className="ad-spinner" aria-hidden="true" />}
                  {userSaving ? 'Creating…' : 'Create user'}
                </button>
              </div>
            </form>
          )}

          {listError && <p className="ad-error ad-list-error" role="alert">{listError}</p>}

          {users.length === 0 ? (
            !userFormOpen && <p className="ad-empty">No users yet.</p>
          ) : filteredUsers.length === 0 ? (
            <p className="ad-empty">No users match “{query}”.</p>
          ) : (
            <ul className="ad-list">
              {filteredUsers.map((u, index) => {
                const isMe = currentUser?.email === u.email;
                const confirming = confirmDeleteId === u.id;
                const busy = deletingId === u.id;
                return (
                  <li key={u.id} className="ad-item" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
                    <span className="ad-avatar" aria-hidden="true">{u.email.charAt(0).toUpperCase()}</span>
                    <div className="ad-main">
                      <span className="ad-name">
                        {u.email}
                        {isMe && <span className="ad-you">You</span>}
                      </span>
                      <span className="ad-meta">
                        {capitalize(u.role)}
                        {u.shop_name ? <><span className="ad-sep">·</span>{u.shop_name}</> : u.role === 'admin' ? <><span className="ad-sep">·</span>All shops</> : null}
                      </span>
                    </div>
                    {!isMe && (
                      <div className="ad-actions">
                        {confirming ? (
                          <>
                            <span className="ad-confirm-text">Delete user?</span>
                            <button type="button" className="ad-pill" disabled={busy} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                            <button type="button" className="ad-pill ad-pill--danger-solid" disabled={busy} onClick={() => deleteUser(u.id)}>
                              {busy ? 'Deleting…' : 'Delete'}
                            </button>
                          </>
                        ) : (
                          <button type="button" className="ad-pill ad-pill--danger"
                            onClick={() => { setConfirmDeleteId(u.id); setListError(''); }}>
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'shops' && isAdmin && (
        <section key="shops" className="ad-panel" aria-labelledby="ad-shops-title">
          <div className="ad-section-head">
            <h2 className="ad-section-title" id="ad-shops-title">Shops</h2>
            <button
              type="button"
              className={shopFormOpen ? 'ad-btn ad-btn--secondary' : 'ad-btn ad-btn--primary'}
              onClick={() => { if (shopFormOpen) resetShopForm(); setShopFormOpen(o => !o); }}
              aria-expanded={shopFormOpen}
            >
              {!shopFormOpen && <PlusIcon />}
              {shopFormOpen ? 'Cancel' : 'Add shop'}
            </button>
          </div>

          {shopFormOpen && (
            <form className="ad-form" onSubmit={createShop} noValidate>
              <div className="ad-row">
                <label className="ad-field">
                  <span className="ad-label">Name</span>
                  <input className="ad-input" value={shopName} onChange={e => setShopName(e.target.value)}
                    placeholder="Downtown" autoFocus />
                </label>
                <label className="ad-field">
                  <span className="ad-label">Address <span className="ad-optional">Optional</span></span>
                  <input className="ad-input" value={shopAddr} onChange={e => setShopAddr(e.target.value)}
                    placeholder="123 Main Street" />
                </label>
              </div>
              {shopError && <p className="ad-error" role="alert">{shopError}</p>}
              <div>
                <button type="submit" className="ad-btn ad-btn--primary ad-btn--lg" disabled={shopSaving}>
                  {shopSaving && <span className="ad-spinner" aria-hidden="true" />}
                  {shopSaving ? 'Creating…' : 'Create shop'}
                </button>
              </div>
            </form>
          )}

          {shops.length === 0 ? (
            !shopFormOpen && <p className="ad-empty">No shops yet. Add your first location to get started.</p>
          ) : (
            <ul className="ad-list">
              {shops.map((sh, index) => (
                <li key={sh.id} className="ad-item ad-item--shop" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
                  <span className="ad-tile"><StoreIcon /></span>
                  <div className="ad-main">
                    <span className="ad-name">{sh.name}</span>
                    {sh.address && <span className="ad-meta">{sh.address}</span>}
                  </div>
                  <dl className="ad-shop-stats">
                    <div><dt>Users</dt><dd>{sh.user_count ?? 0}</dd></div>
                    <div><dt>People</dt><dd>{sh.person_count ?? 0}</dd></div>
                    <div>
                      <dt>Live</dt>
                      <dd>
                        {(sh.active_streams ?? 0) > 0 && <span className="ad-live-dot" aria-hidden="true" />}
                        {sh.active_streams ?? 0}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {toast && (
        <div className="ad-toast" role="status" key={toast}>
          <CheckIcon />{toast}
        </div>
      )}
    </div>
  );
}

const styles = `
.ad {
  --ad-text: #1d1d1f;
  --ad-muted: #6e6e73;
  --ad-faint: #86868b;
  --ad-line: rgba(0, 0, 0, 0.08);
  --ad-soft: rgba(0, 0, 0, 0.04);
  --ad-softer: rgba(0, 0, 0, 0.07);
  --ad-accent: #0071e3;
  --ad-accent-hover: #0077ed;
  --ad-green: #34c759;
  --ad-red: #e30000;
  --ad-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  max-width: 920px;
  margin: 0 auto;
  padding: 56px 24px 112px;
  color: var(--ad-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.ad-visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
}

/* Header */
.ad-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px 24px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--ad-line);
}
.ad-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: clamp(32px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}
.ad-subtitle { margin: 8px 0 0; font-size: 17px; color: var(--ad-muted); font-variant-numeric: tabular-nums; }

/* Segmented control */
.ad-segmented {
  position: relative;
  display: inline-flex;
  padding: 2px;
  border-radius: 10px;
  background: rgba(118, 118, 128, 0.12);
}
.ad-segmented--wide { display: flex; max-width: 420px; }
.ad-segmented-thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12), 0 3px 1px rgba(0, 0, 0, 0.04);
  transition: transform 0.35s cubic-bezier(0.3, 1, 0.4, 1);
}
.ad-segment {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 96px;
  height: 32px;
  padding: 0 16px;
  border: none;
  background: none;
  color: var(--ad-text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: font-weight 0.2s;
}
.ad-segment.is-active { font-weight: 600; }
.ad-segment:focus-visible { outline: none; border-radius: 8px; box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.35); }

/* Panels */
.ad-panel { padding-top: 44px; animation: ad-panel 0.45s var(--ad-ease); }
@keyframes ad-panel { from { opacity: 0; transform: translateY(10px); } }
.ad-section-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ad-line);
}
.ad-section-title { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
.ad-section-tools { display: flex; align-items: center; gap: 12px; }

.ad-search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  background: rgba(118, 118, 128, 0.12);
  color: var(--ad-faint);
  transition: box-shadow 0.2s var(--ad-ease), background 0.2s var(--ad-ease);
}
.ad-search:focus-within { background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.12), 0 0 0 4px rgba(0, 113, 227, 0.15); }
.ad-search input {
  width: 160px;
  border: none;
  background: transparent;
  color: var(--ad-text);
  font: inherit;
  font-size: 15px;
  outline: none;
}

/* Buttons */
.ad-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 18px;
  border: none;
  border-radius: 980px;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s var(--ad-ease), transform 0.2s var(--ad-ease);
}
.ad-btn--lg { height: 44px; padding: 0 24px; font-size: 17px; }
.ad-btn:active:not(:disabled) { transform: scale(0.97); }
.ad-btn:disabled { opacity: 0.55; cursor: default; }
.ad-btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.3); }
.ad-btn--primary { background: var(--ad-accent); color: #fff; }
.ad-btn--primary:hover:not(:disabled) { background: var(--ad-accent-hover); }
.ad-btn--secondary { background: var(--ad-soft); color: var(--ad-text); }
.ad-btn--secondary:hover { background: var(--ad-softer); }
.ad-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ad-spin 0.8s linear infinite;
}
@keyframes ad-spin { to { transform: rotate(360deg); } }

/* Forms */
.ad-form {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 32px 0 40px;
  border-bottom: 1px solid var(--ad-line);
  animation: ad-drop 0.45s var(--ad-ease);
}
@keyframes ad-drop { from { opacity: 0; transform: translateY(-10px); } }
.ad-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.ad-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ad-label { font-size: 14px; font-weight: 500; color: var(--ad-muted); }
.ad-optional { margin-left: 6px; font-weight: 400; color: var(--ad-faint); }
.ad-input {
  width: 100%;
  box-sizing: border-box;
  height: 48px;
  padding: 0 14px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 12px;
  background: #fff;
  color: var(--ad-text);
  font: inherit;
  font-size: 17px;
  transition: border-color 0.2s var(--ad-ease), box-shadow 0.2s var(--ad-ease);
}
.ad-input::placeholder { color: #aeaeb2; }
.ad-input:hover { border-color: rgba(0, 0, 0, 0.28); }
.ad-input:focus { outline: none; border-color: var(--ad-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }
.ad-select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 40px;
  background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%236e6e73' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 16px center;
  cursor: pointer;
}
.ad-password { position: relative; display: block; }
.ad-password .ad-input { padding-right: 64px; }
.ad-reveal {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--ad-accent);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.ad-reveal:hover { background: rgba(0, 113, 227, 0.07); }
.ad-appear { animation: ad-fade 0.3s var(--ad-ease); }
@keyframes ad-fade { from { opacity: 0; transform: translateY(-4px); } }
.ad-note { margin: 0; font-size: 15px; color: var(--ad-muted); }
.ad-error { margin: 0; font-size: 15px; color: var(--ad-red); line-height: 1.5; }
.ad-list-error { padding-top: 16px; }

/* Lists */
.ad-list { list-style: none; margin: 0; padding: 0; }
.ad-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--ad-line);
  animation: ad-rise 0.45s var(--ad-ease) both;
}
@keyframes ad-rise { from { opacity: 0; transform: translateY(8px); } }
.ad-item--shop { padding: 20px 0; }
.ad-avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(180deg, #a1a1a6 0%, #8e8e93 100%);
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  flex-shrink: 0;
}
.ad-tile {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--ad-soft);
  color: var(--ad-muted);
  flex-shrink: 0;
}
.ad-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ad-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ad-item--shop .ad-name { font-weight: 600; letter-spacing: -0.01em; }
.ad-you {
  padding: 1px 8px;
  border-radius: 980px;
  background: var(--ad-soft);
  color: var(--ad-muted);
  font-size: 12px;
  font-weight: 500;
}
.ad-meta {
  font-size: 14px;
  color: var(--ad-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ad-sep { margin: 0 7px; color: #c7c7cc; }

.ad-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.ad-pill {
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 980px;
  background: var(--ad-soft);
  color: var(--ad-text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s var(--ad-ease), opacity 0.2s var(--ad-ease), transform 0.2s var(--ad-ease);
}
.ad-pill:hover:not(:disabled) { background: var(--ad-softer); }
.ad-pill:active:not(:disabled) { transform: scale(0.96); }
.ad-pill:disabled { opacity: 0.5; cursor: default; }
.ad-pill--danger { background: transparent; color: var(--ad-red); opacity: 0; }
.ad-item:hover .ad-pill--danger, .ad-pill--danger:focus-visible { opacity: 1; }
.ad-pill--danger:hover:not(:disabled) { background: rgba(227, 0, 0, 0.07); }
.ad-pill--danger-solid { background: var(--ad-red); color: #fff; }
.ad-pill--danger-solid:hover:not(:disabled) { background: #c80000; }
.ad-pill:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.35); }
.ad-confirm-text { font-size: 14px; color: var(--ad-muted); margin-right: 4px; animation: ad-fade 0.25s var(--ad-ease); }

.ad-shop-stats {
  display: flex;
  gap: 32px;
  margin: 0;
  text-align: right;
}
.ad-shop-stats dt { font-size: 12px; color: var(--ad-faint); }
.ad-shop-stats dd {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.015em;
  font-variant-numeric: tabular-nums;
}
.ad-live-dot { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--ad-green); }
.ad-live-dot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: ad-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes ad-ping { 75%, 100% { transform: scale(2.6); opacity: 0; } }

.ad-empty { margin: 0; padding: 56px 0; text-align: center; font-size: 17px; color: var(--ad-muted); }

/* Toast */
.ad-toast {
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
  animation: ad-toast 3s var(--ad-ease) both;
}
.ad-toast svg { color: var(--ad-green); }
@keyframes ad-toast {
  0% { opacity: 0; transform: translate(-50%, 16px) scale(0.96); }
  10%, 85% { opacity: 1; transform: translate(-50%, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, 8px) scale(0.98); }
}

/* Responsive */
@media (hover: none) {
  .ad-pill--danger { opacity: 1; }
}
@media (max-width: 720px) {
  .ad { padding: 40px 16px 80px; }
  .ad-row { grid-template-columns: 1fr; }
  .ad-section-tools { width: 100%; }
  .ad-search { flex: 1; }
  .ad-search input { width: 100%; }
  .ad-item { flex-wrap: wrap; }
  .ad-actions { width: 100%; padding-left: 56px; }
  .ad-item--shop .ad-shop-stats { width: 100%; padding-left: 60px; justify-content: flex-start; text-align: left; gap: 28px; }
  .ad-shop-stats dd { justify-content: flex-start; }
  .ad-segment { min-width: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ad *, .ad *::after { animation: none !important; transition: none !important; }
}
`;