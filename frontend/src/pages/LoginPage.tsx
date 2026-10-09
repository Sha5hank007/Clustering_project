import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

const BrandMark = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2" />
    <circle cx="12" cy="10" r="2.6" />
    <path d="M7.5 17c.8-2.1 2.5-3.2 4.5-3.2s3.7 1.1 4.5 3.2" />
  </svg>
);

const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cardRef = useRef<HTMLFormElement>(null);

  const fail = (message: string) => {
    setError(message);
    // Replay the shake animation, macOS-login style
    const card = cardRef.current;
    if (card) {
      card.classList.remove('is-shaking');
      void card.offsetWidth;
      card.classList.add('is-shaking');
    }
  };

  // Handle Google OAuth callback redirect
  useEffect(() => {
    const token = searchParams.get('token');
    const oauthError = searchParams.get('error');

    if (oauthError === 'no_account') {
      fail('No account found for this Google email. Contact your admin.');
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
      // replace: keeps the token out of the browser's back-button history
      navigate('/', { replace: true });
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      fail('Enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email: email.trim(), password });
      login(res.data);
      navigate('/', { replace: true });
    } catch (err: any) {
      fail(err.response?.data?.detail || 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setRedirecting(true);
    window.location.href = `${BACKEND_URL}/api/auth/google/login`;
  };

  const busy = loading || redirecting;

  return (
    <div className="lg">
      <style>{styles}</style>

      <div className="lg-bg" aria-hidden="true">
        <span className="lg-orb lg-orb--a" />
        <span className="lg-orb lg-orb--b" />
        <span className="lg-orb lg-orb--c" />
      </div>

      <main className="lg-wrap">
        <form ref={cardRef} onSubmit={handleSubmit} className="lg-card" noValidate
          onAnimationEnd={e => { if (e.animationName === 'lg-shake') e.currentTarget.classList.remove('is-shaking'); }}>
          <div className="lg-mark lg-step" style={{ animationDelay: '0ms' }}><BrandMark /></div>

          <h1 className="lg-title lg-step" style={{ animationDelay: '60ms' }}>Sign in to FaceTrack</h1>
          <p className="lg-subtitle lg-step" style={{ animationDelay: '110ms' }}>Welcome back. Enter your details to continue.</p>

          {GOOGLE_CLIENT_ID && (
            <div className="lg-step" style={{ animationDelay: '160ms' }}>
              <button type="button" onClick={handleGoogleLogin} className="lg-google" disabled={busy}>
                {redirecting ? <span className="lg-spinner lg-spinner--dark" aria-hidden="true" /> : <GoogleLogo />}
                Continue with Google
              </button>
              <div className="lg-divider"><span>or</span></div>
            </div>
          )}

          <div className="lg-fields lg-step" style={{ animationDelay: GOOGLE_CLIENT_ID ? '210ms' : '160ms' }}>
            <div className="lg-float">
              <input
                id="lg-email"
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (error) setError(''); }}
                placeholder=" "
                autoComplete="username"
                autoFocus
                aria-invalid={!!error}
                disabled={busy}
              />
              <label htmlFor="lg-email">Email</label>
            </div>

            <div className="lg-float lg-float--password">
              <input
                id="lg-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
                placeholder=" "
                autoComplete="current-password"
                aria-invalid={!!error}
                disabled={busy}
              />
              <label htmlFor="lg-password">Password</label>
              <button
                type="button"
                className="lg-reveal"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="lg-error-slot" aria-live="assertive">
            {error && <p className="lg-error" role="alert">{error}</p>}
          </div>

          <div className="lg-step" style={{ animationDelay: GOOGLE_CLIENT_ID ? '260ms' : '210ms' }}>
            <button type="submit" disabled={busy} className="lg-submit">
              {loading && <span className="lg-spinner" aria-hidden="true" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>

          <p className="lg-foot lg-step" style={{ animationDelay: GOOGLE_CLIENT_ID ? '310ms' : '260ms' }}>
            Accounts are created by your administrator.
          </p>
        </form>
      </main>
    </div>
  );
}

const styles = `
.lg {
  --lg-text: #1d1d1f;
  --lg-muted: #6e6e73;
  --lg-faint: #86868b;
  --lg-line: rgba(0, 0, 0, 0.08);
  --lg-accent: #0071e3;
  --lg-accent-hover: #0077ed;
  --lg-red: #e30000;
  --lg-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  background: #fbfbfd;
  color: var(--lg-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Soft animated background */
.lg-bg { position: absolute; inset: 0; pointer-events: none; }
.lg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.55;
  will-change: transform;
}
.lg-orb--a {
  width: 520px; height: 520px;
  top: -160px; left: -120px;
  background: radial-gradient(circle, rgba(0, 113, 227, 0.35), rgba(0, 113, 227, 0) 70%);
  animation: lg-drift-a 22s ease-in-out infinite alternate;
}
.lg-orb--b {
  width: 460px; height: 460px;
  bottom: -160px; right: -100px;
  background: radial-gradient(circle, rgba(175, 82, 222, 0.28), rgba(175, 82, 222, 0) 70%);
  animation: lg-drift-b 26s ease-in-out infinite alternate;
}
.lg-orb--c {
  width: 360px; height: 360px;
  top: 40%; left: 55%;
  background: radial-gradient(circle, rgba(52, 199, 89, 0.16), rgba(52, 199, 89, 0) 70%);
  animation: lg-drift-c 30s ease-in-out infinite alternate;
}
@keyframes lg-drift-a { to { transform: translate(120px, 90px) scale(1.15); } }
@keyframes lg-drift-b { to { transform: translate(-110px, -80px) scale(1.1); } }
@keyframes lg-drift-c { to { transform: translate(-160px, 60px) scale(0.9); } }

/* Layout */
.lg-wrap {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  padding: 48px 20px;
}
.lg-card {
  width: min(100%, 420px);
  padding: 44px 40px 36px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.72);
  -webkit-backdrop-filter: saturate(180%) blur(30px);
  backdrop-filter: saturate(180%) blur(30px);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.05), 0 30px 80px -30px rgba(0, 0, 0, 0.25);
  text-align: center;
}
.lg-card.is-shaking { animation: lg-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
@keyframes lg-shake {
  10%, 90% { transform: translateX(-2px); }
  20%, 80% { transform: translateX(4px); }
  30%, 50%, 70% { transform: translateX(-8px); }
  40%, 60% { transform: translateX(8px); }
}

/* Staggered entrance */
.lg-step { animation: lg-in 0.8s var(--lg-ease) both; }
@keyframes lg-in { from { opacity: 0; transform: translateY(14px); } }

.lg-mark {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin: 0 auto 24px;
  border-radius: 18px;
  background: linear-gradient(180deg, #3a3a3c 0%, #1d1d1f 100%);
  color: #fff;
  box-shadow: 0 10px 24px -8px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.lg-title {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.lg-subtitle { margin: 10px 0 32px; font-size: 17px; color: var(--lg-muted); line-height: 1.4; }

/* Google */
.lg-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 50px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 980px;
  background: #fff;
  color: var(--lg-text);
  font: inherit;
  font-size: 17px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.2s var(--lg-ease);
}
.lg-google:hover:not(:disabled) { background: #f5f5f7; border-color: rgba(0, 0, 0, 0.22); }
.lg-google:active:not(:disabled) { transform: scale(0.98); }
.lg-google:disabled { opacity: 0.6; cursor: default; }
.lg-divider {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 22px 0;
  color: var(--lg-faint);
  font-size: 13px;
}
.lg-divider::before, .lg-divider::after { content: ""; flex: 1; height: 1px; background: var(--lg-line); }

/* Floating-label fields */
.lg-fields { display: flex; flex-direction: column; gap: 12px; text-align: left; }
.lg-float { position: relative; }
.lg-float input {
  width: 100%;
  height: 58px;
  padding: 24px 16px 8px;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 14px;
  background: #fff;
  color: var(--lg-text);
  font: inherit;
  font-size: 17px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.lg-float--password input { padding-right: 68px; }
.lg-float input:hover:not(:disabled) { border-color: rgba(0, 0, 0, 0.3); }
.lg-float input:focus { border-color: var(--lg-accent); box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15); }
.lg-float input[aria-invalid="true"] { border-color: rgba(227, 0, 0, 0.55); }
.lg-float input[aria-invalid="true"]:focus { box-shadow: 0 0 0 4px rgba(227, 0, 0, 0.1); }
.lg-float input:disabled { opacity: 0.6; }
.lg-float label {
  position: absolute;
  left: 17px;
  top: 29px;
  transform: translateY(-50%);
  color: var(--lg-faint);
  font-size: 17px;
  pointer-events: none;
  transform-origin: left center;
  transition: top 0.22s var(--lg-ease), font-size 0.22s var(--lg-ease), color 0.22s;
}
.lg-float input:focus + label,
.lg-float input:not(:placeholder-shown) + label,
.lg-float input:-webkit-autofill + label {
  top: 17px;
  font-size: 12px;
}
.lg-float input:focus + label { color: var(--lg-accent); }
.lg-reveal {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: 9px;
  background: none;
  color: var(--lg-accent);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.lg-reveal:hover { background: rgba(0, 113, 227, 0.07); }

/* Error */
.lg-error-slot { min-height: 26px; padding: 10px 2px 0; text-align: left; }
.lg-error { margin: 0; font-size: 14px; color: var(--lg-red); line-height: 1.4; animation: lg-fade 0.3s var(--lg-ease); }
@keyframes lg-fade { from { opacity: 0; transform: translateY(-3px); } }

/* Submit */
.lg-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 50px;
  margin-top: 14px;
  border: none;
  border-radius: 980px;
  background: var(--lg-accent);
  color: #fff;
  font: inherit;
  font-size: 17px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, transform 0.2s var(--lg-ease), opacity 0.2s;
}
.lg-submit:hover:not(:disabled) { background: var(--lg-accent-hover); }
.lg-submit:active:not(:disabled) { transform: scale(0.98); }
.lg-submit:disabled { opacity: 0.6; cursor: default; }
.lg-submit:focus-visible, .lg-google:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.3); }

.lg-spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: lg-spin 0.8s linear infinite;
}
.lg-spinner--dark { border-color: rgba(0, 0, 0, 0.15); border-top-color: var(--lg-text); }
@keyframes lg-spin { to { transform: rotate(360deg); } }

.lg-foot { margin: 22px 0 0; font-size: 13px; color: var(--lg-faint); }

/* Phones: drop the card, let the page be the card */
@media (max-width: 520px) {
  .lg-wrap { place-items: start center; padding: 72px 20px 40px; }
  .lg-card { padding: 0; background: none; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .lg-orb { opacity: 0.4; }
}

@media (prefers-reduced-motion: reduce) {
  .lg *, .lg *::before, .lg *::after { animation: none !important; transition: none !important; }
}
`;