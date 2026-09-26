import { useEffect, useState } from 'react';
import api from '../api/client';
import { Shop, User } from '../types';
import { useAuth } from '../context/AuthContext';

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [shopName, setShopName] = useState(''); const [shopAddr, setShopAddr] = useState('');
  const [userEmail, setUserEmail] = useState(''); const [userPass, setUserPass] = useState('');
  const [userRole, setUserRole] = useState('guard'); const [userShop, setUserShop] = useState('');
  const [message, setMessage] = useState('');

  const loadShops = () => api.get('/admin/shops').then(r => setShops(r.data.shops)).catch(() => {});
  const loadUsers = () => api.get('/admin/users').then(r => setUsers(r.data.users)).catch(() => {});
  useEffect(() => { loadShops(); loadUsers(); }, []);

  const createShop = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post('/admin/shops', { name: shopName, address: shopAddr || null }); setShopName(''); setShopAddr(''); setMessage('Shop created'); loadShops(); }
    catch (err: any) { setMessage(err.response?.data?.detail || 'Failed'); }
  };
  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/admin/users', { email: userEmail, password: userPass, role: userRole, shop_id: userRole === 'admin' ? null : parseInt(userShop) });
      setUserEmail(''); setUserPass(''); setMessage('User created'); loadUsers();
    } catch (err: any) { setMessage(err.response?.data?.detail || 'Failed'); }
  };
  const deleteUser = async (id: number) => { if (!confirm('Delete this user?')) return; try { await api.delete(`/admin/users/${id}`); loadUsers(); } catch (err: any) { setMessage(err.response?.data?.detail || 'Failed'); } };

  return (
    <div style={s.container}>
      <h1 style={s.title}>Admin Panel</h1>
      {message && <div style={s.message}>{message}</div>}
      {isAdmin && (<>
        <h2 style={s.subtitle}>Shops</h2>
        <form onSubmit={createShop} style={s.form}>
          <input placeholder="Shop name" value={shopName} onChange={e => setShopName(e.target.value)} style={s.input} required />
          <input placeholder="Address (optional)" value={shopAddr} onChange={e => setShopAddr(e.target.value)} style={s.input} />
          <button type="submit" style={s.button}>Create Shop</button>
        </form>
        <div style={s.list}>{shops.map(sh => (
          <div key={sh.id} style={s.listItem}><strong>{sh.name}</strong><span style={s.listMeta}>{sh.user_count} users • {sh.person_count} persons • {sh.active_streams} streams</span></div>
        ))}</div>
      </>)}
      <h2 style={s.subtitle}>Users</h2>
      <form onSubmit={createUser} style={s.form}>
        <input placeholder="Email" type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} style={s.input} required />
        <input placeholder="Password" type="password" value={userPass} onChange={e => setUserPass(e.target.value)} style={s.input} required />
        <select value={userRole} onChange={e => setUserRole(e.target.value)} style={s.input}>
          <option value="guard">Guard</option><option value="manager">Manager</option>{isAdmin && <option value="admin">Admin</option>}
        </select>
        {userRole !== 'admin' && <select value={userShop} onChange={e => setUserShop(e.target.value)} style={s.input} required><option value="">Select shop...</option>{shops.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}</select>}
        <button type="submit" style={s.button}>Create User</button>
      </form>
      <div style={s.list}>{users.map(u => (
        <div key={u.id} style={s.listItem}>
          <div><strong>{u.email}</strong><span style={s.roleBadge}>{u.role}</span>{u.shop_name && <span style={s.listMeta}> @ {u.shop_name}</span>}</div>
          <button onClick={() => deleteUser(u.id)} style={s.deleteBtn}>Delete</button>
        </div>
      ))}</div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: 28, maxWidth: 800, margin: '0 auto' },
  title: { color: '#1e293b', marginBottom: 16, fontWeight: 700 },
  subtitle: { color: '#1e293b', marginTop: 28, marginBottom: 12, fontWeight: 600, fontSize: 18 },
  message: { background: '#ecfdf5', color: '#059669', padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 14, border: '1px solid #bbf7d0' },
  form: { background: '#fff', padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  input: { padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', fontSize: 14, outline: 'none' },
  button: { padding: 10, borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  listItem: { background: '#fff', padding: 14, borderRadius: 10, color: '#1e293b', fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  listMeta: { color: '#94a3b8', fontSize: 13, marginLeft: 8 },
  roleBadge: { background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, marginLeft: 8, textTransform: 'uppercase' as const },
  deleteBtn: { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500 },
};
