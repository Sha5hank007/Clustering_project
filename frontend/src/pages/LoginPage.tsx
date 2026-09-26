import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      login(res.data);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.container}>
      <form onSubmit={handleSubmit} style={s.form}>
        <div style={s.logoSection}>
          <div style={s.logoIcon}>🔍</div>
          <h1 style={s.title}>FaceTrack</h1>
          <p style={s.subtitle}>Sign in to your account</p>
        </div>
        {error && <div style={s.error}>{error}</div>}
        <div style={s.field}>
          <label style={s.label}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={s.input} required />
        </div>
        <div style={s.field}>
          <label style={s.label}>Password</label>
          <div style={s.passwordWrap}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={s.passwordInput}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(value => !value)}
              style={s.togglePassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <button type="submit" disabled={loading} style={s.button}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f1f5f9' },
  form: { background: '#fff', padding: 40, borderRadius: 16, width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 16 },
  logoSection: { textAlign: 'center', marginBottom: 8 },
  logoIcon: { fontSize: 40 },
  title: { color: '#1e293b', margin: '8px 0 0', fontSize: 26, fontWeight: 700 },
  subtitle: { color: '#94a3b8', margin: '4px 0 0', fontSize: 14 },
  error: { background: '#fef2f2', color: '#dc2626', padding: 12, borderRadius: 8, fontSize: 14, textAlign: 'center', border: '1px solid #fecaca' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: '#475569' },
  input: { padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', fontSize: 14, outline: 'none' },
  passwordWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  passwordInput: { width: '100%', padding: 12, paddingRight: 58, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  togglePassword: { position: 'absolute', right: 10, border: 'none', background: 'transparent', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 4 },
  button: { padding: 12, borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 15, cursor: 'pointer', fontWeight: 600, marginTop: 4 },
};
