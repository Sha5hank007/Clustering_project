import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const requestReset = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to process this request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="pr">
      <style>{styles}</style>
      <section className="pr-panel">
        <p className="pr-eyebrow">FaceTrack account recovery</p>
        <h1>Forgot password?</h1>
        {submitted ? (
          <p className="pr-copy" role="status">
            If an eligible account exists for that email, a reset link will be sent. Check your inbox.
          </p>
        ) : (
          <>
            <p className="pr-copy">Enter your account email and we’ll send a one-time reset link.</p>
            <form onSubmit={requestReset} className="pr-form">
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={event => setEmail(event.target.value)}
                  autoComplete="email" maxLength={255} autoFocus required />
              </label>
              {error && <p className="pr-error" role="alert">{error}</p>}
              <button type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
            </form>
          </>
        )}
        <Link className="pr-back" to="/login">Back to sign in</Link>
      </section>
    </main>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!token) {
      setError('This reset link is missing its token. Request another link.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setCompleted(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to reset the password. Request another link.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="pr">
      <style>{styles}</style>
      <section className="pr-panel">
        <p className="pr-eyebrow">FaceTrack account recovery</p>
        <h1>Set a new password</h1>
        {completed ? (
          <>
            <p className="pr-copy" role="status">Your password has been reset.</p>
            <Link className="pr-action" to="/login">Continue to sign in</Link>
          </>
        ) : (
          <form onSubmit={resetPassword} className="pr-form">
            <label>
              <span>New password</span>
              <input type="password" value={password} onChange={event => setPassword(event.target.value)}
                minLength={8} maxLength={72} autoComplete="new-password" required />
              <small>8–72 characters, including a letter and a number.</small>
            </label>
            <label>
              <span>Confirm password</span>
              <input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)}
                minLength={8} maxLength={72} autoComplete="new-password" required />
            </label>
            {error && <p className="pr-error" role="alert">{error}</p>}
            <button type="submit" disabled={saving}>{saving ? 'Updating…' : 'Reset password'}</button>
          </form>
        )}
        {!completed && <Link className="pr-back" to="/login">Back to sign in</Link>}
      </section>
    </main>
  );
}

const styles = `
.pr { min-height: 100vh; display: grid; place-items: center; padding: 32px 18px; color: #1d1d1f; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; }
.pr-panel { width: min(100%, 440px); }
.pr-eyebrow { margin: 0 0 10px; color: #0071e3; font-size: 13px; font-weight: 600; text-transform: uppercase; }
.pr h1 { margin: 0; font-size: 36px; }
.pr-copy { color: #6e6e73; font-size: 16px; line-height: 1.5; }
.pr-form { display: grid; gap: 18px; margin-top: 26px; }
.pr-form label { display: grid; gap: 7px; color: #6e6e73; font-size: 14px; }
.pr-form input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid rgba(0,0,0,.14); border-radius: 9px; color: #1d1d1f; font: inherit; }
.pr-form input:focus { outline: 3px solid rgba(0,113,227,.17); border-color: #0071e3; }
.pr-form small { color: #86868b; }
.pr-form button, .pr-action { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 0 18px; border: 0; border-radius: 8px; background: #0071e3; color: white; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
.pr-form button:disabled { opacity: .6; cursor: wait; }
.pr-error { margin: 0; color: #c62828; font-size: 14px; }
.pr-back { display: inline-block; margin-top: 24px; color: #0071e3; font-size: 14px; text-decoration: none; }
.pr-back:hover { text-decoration: underline; }
`;