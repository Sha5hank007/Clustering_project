import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';

interface InviteInfo {
  email: string;
  organization_name: string;
  expires_at: string;
}

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError('This invitation link is missing its token.');
      setLoading(false);
      return () => { cancelled = true; };
    }
    api.get('/auth/invite-info', { params: { token } })
      .then(result => { if (!cancelled) setInvite(result.data); })
      .catch(err => {
        if (!cancelled) setError(err.response?.data?.detail || 'This invitation is invalid or expired.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const acceptInvite = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/accept-invite', { token, password });
      navigate('/login?invite=accepted', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to complete account setup.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="ai">
      <style>{styles}</style>
      <section className="ai-panel">
        <p className="ai-eyebrow">FaceTrack account setup</p>
        <h1>Join your organization</h1>
        {loading ? <p className="ai-muted">Checking your invitation…</p> : invite ? (
          <>
            <p className="ai-muted">
              Set a password for <strong>{invite.email}</strong> to administer {invite.organization_name}.
            </p>
            <form onSubmit={acceptInvite} className="ai-form">
              <label>
                <span>Password</span>
                <input type="password" value={password} onChange={event => setPassword(event.target.value)}
                  minLength={8} maxLength={72} autoComplete="new-password" required />
                <small>8–72 characters, including a letter and a number.</small>
              </label>
              <label>
                <span>Confirm password</span>
                <input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)}
                  minLength={8} maxLength={72} autoComplete="new-password" required />
              </label>
              {error && <p className="ai-error" role="alert">{error}</p>}
              <button type="submit" disabled={saving}>{saving ? 'Setting up…' : 'Set password'}</button>
            </form>
          </>
        ) : (
          <>
            <p className="ai-error" role="alert">{error}</p>
            <p className="ai-muted">Ask the platform administrator to send you a new invitation.</p>
          </>
        )}
        <Link className="ai-back" to="/login">Back to sign in</Link>
      </section>
    </main>
  );
}

const styles = `
.ai { min-height: calc(100vh - 52px); display: grid; place-items: center; padding: 32px 18px; color: #1d1d1f; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; }
.ai-panel { width: min(100%, 480px); }
.ai-eyebrow { margin: 0 0 10px; color: #0071e3; font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.ai h1 { margin: 0; font-size: clamp(32px, 5vw, 44px); letter-spacing: -.035em; }
.ai-muted { color: #6e6e73; font-size: 16px; line-height: 1.5; }
.ai-muted strong { color: #1d1d1f; }
.ai-form { display: grid; gap: 18px; margin-top: 26px; }
.ai-form label { display: grid; gap: 7px; color: #6e6e73; font-size: 14px; }
.ai-form input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid rgba(0,0,0,.14); border-radius: 9px; color: #1d1d1f; font: inherit; }
.ai-form input:focus { outline: 3px solid rgba(0,113,227,.17); border-color: #0071e3; }
.ai-form small { color: #86868b; }
.ai-form button { min-height: 44px; border: 0; border-radius: 999px; background: #0071e3; color: white; font: inherit; font-weight: 600; cursor: pointer; }
.ai-form button:disabled { opacity: .6; cursor: wait; }
.ai-error { color: #c62828; font-size: 14px; }
.ai-back { display: inline-block; margin-top: 24px; color: #0071e3; font-size: 14px; text-decoration: none; }
.ai-back:hover { text-decoration: underline; }
`;
