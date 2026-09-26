import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout, isAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => { logout(); navigate('/login'); };

  const navLink = (to: string, label: string) => {
    const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
    return <Link to={to} style={{ ...s.link, ...(active ? s.activeLink : {}) }}>{label}</Link>;
  };

  return (
    <nav style={s.nav}>
      <Link to="/" style={s.logo}>🔍 FaceTrack</Link>
      <div style={s.links}>
        {navLink('/', 'Dashboard')}
        {navLink('/ingest', 'Upload')}
        {navLink('/streams', 'Streams')}
        {navLink('/persons', 'Persons')}
        {navLink('/identify', 'Identify')}
        {(isAdmin || isManager) && navLink('/admin', 'Admin')}
      </div>
      <div style={s.user}>
        <span style={s.role}>{user?.role}</span>
        <span style={s.email}>{user?.email}</span>
        <button onClick={handleLogout} style={s.logoutBtn}>Logout</button>
      </div>
    </nav>
  );
}

const s: Record<string, React.CSSProperties> = {
  nav: { display: 'flex', alignItems: 'center', padding: '0 24px', height: 56, background: '#fff', borderBottom: '1px solid #e2e8f0', gap: 24 },
  logo: { color: '#2563eb', fontSize: 18, fontWeight: 700, textDecoration: 'none', marginRight: 16 },
  links: { display: 'flex', gap: 2, flex: 1 },
  link: { color: '#64748b', textDecoration: 'none', fontSize: 14, padding: '8px 14px', borderRadius: 6, fontWeight: 500 },
  activeLink: { color: '#2563eb', background: '#eff6ff', fontWeight: 600 },
  user: { display: 'flex', alignItems: 'center', gap: 10 },
  role: { fontSize: 11, color: '#2563eb', background: '#eff6ff', padding: '3px 10px', borderRadius: 10, textTransform: 'uppercase' as const, fontWeight: 700, letterSpacing: 0.5 },
  email: { fontSize: 13, color: '#94a3b8' },
  logoutBtn: { background: 'transparent', color: '#ef4444', border: '1px solid #fecaca', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500 },
};
