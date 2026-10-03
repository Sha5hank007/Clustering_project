import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const BACKEND_URL = 'http://localhost:8000';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle Google OAuth callback redirect
  useEffect(() => {
    const token = searchParams.get('token');
    const oauthError = searchParams.get('error');

    if (oauthError === 'no_account') {
      setError('No account found for this Google email. Contact your admin.');
      return;
    }

    if (token) {
      login({
        token,
        user_id: Number(searchParams.get('user_id')),
        email: searchParams.get('email') || '',
        role: searchParams.get('role') || '',
        tenant_id: Number(searchParams.get('tenant_id')),
        shop_id: searchParams.get('shop_id') ? Number(searchParams.get('shop_id')) : null,
      });
      navigate('/');
    }
  }, [searchParams]);

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

  const handleGoogleLogin = () => {
    window.location.href = `${BACKEND_URL}/api/auth/google/login`;
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

        {/* Google Sign-In Button */}
        {GOOGLE_CLIENT_ID && (
          <>
            <button type="button" onClick={handleGoogleLogin} style={s.googleBtn}>
              <svg width="18" height="18" viewBox="0 0 48 48" style={{ marginRight: 10, flexShrink: 0 }}>
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Sign in with Google
            </button>
            <div style={s.divider}>
              <span style={s.dividerLine} />
              <span style={s.dividerText}>or</span>
              <span style={s.dividerLine} />
            </div>
          </>
        )}

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
              onClick={() => setShowPassword(v => !v)}
              style={s.togglePassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
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
  googleBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 12, borderRadius: 8, border: '1px solid #e2e8f0',
    background: '#fff', color: '#1e293b', fontSize: 15, fontWeight: 600,
    cursor: 'pointer', transition: 'background 0.15s',
  },
  divider: { display: 'flex', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, background: '#e2e8f0' },
  dividerText: { color: '#94a3b8', fontSize: 13 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: '#475569' },
  input: { padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', fontSize: 14, outline: 'none' },
  passwordWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  passwordInput: { width: '100%', padding: 12, paddingRight: 58, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  togglePassword: { position: 'absolute', right: 10, border: 'none', background: 'transparent', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 4 },
  button: { padding: 12, borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 15, cursor: 'pointer', fontWeight: 600, marginTop: 4 },
};