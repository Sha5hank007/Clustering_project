import { FormEvent, useEffect, useState } from 'react';
import api from '../api/client';

interface Organization {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string | null;
  shop_count: number;
  user_count: number;
  admin_email: string | null;
  admin_invite_status: 'not_invited' | 'pending' | 'accepted' | 'expired' | 'revoked';
  admin_invite_expires_at: string | null;
}

interface AuditEvent {
  id: number;
  organization_name: string | null;
  actor_email: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string | null;
}

function responseError(error: any, fallback: string) {
  return error.response?.data?.detail || fallback;
}

export default function SuperadminPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activity, setActivity] = useState<AuditEvent[]>([]);
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [inviteAdminId, setInviteAdminId] = useState<number | null>(null);
  const [inviteAdminEmail, setInviteAdminEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const duplicateOrganization = organizations.some(
    organization => organization.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadOrganizations = async () => {
    setError('');
    try {
      const result = await api.get('/superadmin/organizations');
      setOrganizations(result.data.organizations || []);
    } catch (err: any) {
      setError(responseError(err, 'Unable to load organizations.'));
    } finally {
      setLoading(false);
    }
  };

  const loadActivity = async () => {
    try {
      const result = await api.get('/superadmin/audit', { params: { limit: 30 } });
      setActivity(result.data.events || []);
    } catch (err: any) {
      setError(responseError(err, 'Unable to load recent activity.'));
    }
  };

  useEffect(() => {
    void loadOrganizations();
    void loadActivity();
  }, []);

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (duplicateOrganization) {
      setError('An organization with this name already exists. Invite an admin from its row instead.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.post('/superadmin/organizations', {
        name: name.trim(),
        admin_email: adminEmail.trim(),
      });
      setName('');
      setAdminEmail('');
      setNotice('Organization created. The first-admin invitation has been sent.');
      await loadOrganizations();
      await loadActivity();
    } catch (err: any) {
      setError(responseError(err, 'Unable to create the organization.'));
    } finally {
      setSaving(false);
    }
  };

  const inviteAdmin = async (event: FormEvent, organization: Organization) => {
    event.preventDefault();
    setBusyId(organization.id);
    setError('');
    setNotice('');
    try {
      await api.post(`/superadmin/organizations/${organization.id}/admins/invite`, {
        email: inviteAdminEmail.trim(),
      });
      setInviteAdminEmail('');
      setInviteAdminId(null);
      setNotice(`An administrator invitation was sent to ${inviteAdminEmail.trim()}.`);
      await loadOrganizations();
      await loadActivity();
    } catch (err: any) {
      setError(responseError(err, 'Unable to invite this administrator.'));
    } finally {
      setBusyId(null);
    }
  };

  const resendInvite = async (organization: Organization) => {
    setBusyId(organization.id);
    setError('');
    setNotice('');
    try {
      await api.post(`/superadmin/organizations/${organization.id}/resend-invite`);
      setNotice(`A new invitation was sent to ${organization.admin_email}.`);
      await loadOrganizations();
      await loadActivity();
    } catch (err: any) {
      setError(responseError(err, 'Unable to resend the invitation.'));
    } finally {
      setBusyId(null);
    }
  };

  const setActive = async (organization: Organization) => {
    const action = organization.is_active ? 'suspend' : 'reactivate';
    if (!window.confirm(`${action === 'suspend' ? 'Suspend' : 'Reactivate'} ${organization.name}?`)) return;
    setBusyId(organization.id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/superadmin/organizations/${organization.id}/status`, {
        is_active: !organization.is_active,
      });
      setNotice(`${organization.name} ${organization.is_active ? 'suspended' : 'reactivated'}.`);
      await loadOrganizations();
      await loadActivity();
    } catch (err: any) {
      setError(responseError(err, `Unable to ${action} the organization.`));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="sa">
      <style>{styles}</style>
      <header className="sa-header">
        <p className="sa-eyebrow">Platform</p>
        <h1>Organizations</h1>
        <p className="sa-subtitle">Provision organizations and manage platform access.</p>
      </header>

      <section className="sa-create" aria-labelledby="sa-create-title">
        <div className="sa-section-heading">
          <div>
            <h2 id="sa-create-title">Create an organization</h2>
            <p>The first admin will receive a secure, time-limited setup link.</p>
          </div>
        </div>
        <form onSubmit={createOrganization} className="sa-form">
          <label>
            <span>Organization name</span>
            <input value={name} onChange={event => setName(event.target.value)} required maxLength={255}
              aria-invalid={duplicateOrganization} />
          </label>
          <label>
            <span>First admin email</span>
            <input type="email" value={adminEmail} onChange={event => setAdminEmail(event.target.value)}
              required maxLength={255} autoComplete="email" />
          </label>
          <button type="submit" disabled={saving || duplicateOrganization}>
            {saving ? 'Creating…' : 'Create and invite'}
          </button>
        </form>
        {duplicateOrganization && (
          <p className="sa-inline-error" role="status">
            This organization already exists. Use its Invite admin action below instead of creating a duplicate.
          </p>
        )}
        <p className="sa-note">You won’t set or see the admin’s password. Access is limited to this organization.</p>
      </section>

      {error && <p className="sa-message sa-message--error" role="alert">{error}</p>}
      {notice && <p className="sa-message" role="status">{notice}</p>}

      <section className="sa-list-section" aria-labelledby="sa-list-title">
        <div className="sa-list-heading">
          <h2 id="sa-list-title">All organizations</h2>
          <span>{organizations.length.toLocaleString()}</span>
        </div>
        {loading ? <p className="sa-empty">Loading organizations…</p> : organizations.length === 0 ? (
          <p className="sa-empty">No organizations have been created.</p>
        ) : (
          <ul className="sa-list">
            {organizations.map(organization => {
              const invitePending = organization.admin_invite_status !== 'accepted' && !!organization.admin_email;
              const working = busyId === organization.id;
              return (
                <li key={organization.id} className={`sa-row${organization.is_active ? '' : ' is-suspended'}`}>
                  <div className="sa-org">
                    <h3>{organization.name}</h3>
                    <span className="sa-org-meta">
                      {organization.user_count} {organization.user_count === 1 ? 'user' : 'users'}
                      <span>·</span>
                      {organization.shop_count} {organization.shop_count === 1 ? 'shop' : 'shops'}
                      {organization.created_at && <><span>·</span>Created {new Date(organization.created_at).toLocaleDateString()}</>}
                    </span>
                    {organization.admin_email && (
                      <span className="sa-invite-meta">
                        First admin: {organization.admin_email} · Invite {organization.admin_invite_status}
                      </span>
                    )}
                  </div>
                  <div className="sa-actions">
                    <span className={`sa-status${organization.is_active ? '' : ' sa-status--off'}`}>
                      {organization.is_active ? 'Active' : 'Suspended'}
                    </span>
                    {invitePending && organization.is_active && (
                      <button type="button" className="sa-text-button" disabled={working}
                        onClick={() => void resendInvite(organization)}>
                        {working ? 'Sending…' : 'Resend invite'}
                      </button>
                    )}
                    {organization.is_active && (
                      <button type="button" className="sa-text-button"
                        onClick={() => {
                          setInviteAdminId(inviteAdminId === organization.id ? null : organization.id);
                          setInviteAdminEmail('');
                          setError('');
                        }}>
                        {inviteAdminId === organization.id ? 'Cancel invite' : 'Invite admin'}
                      </button>
                    )}
                    <button type="button" className="sa-text-button" disabled={working}
                      onClick={() => void setActive(organization)}>
                      {organization.is_active ? 'Suspend' : 'Reactivate'}
                    </button>
                  </div>
                  {inviteAdminId === organization.id && (
                    <form className="sa-invite-form" onSubmit={event => void inviteAdmin(event, organization)}>
                      <label>
                        <span>Administrator email</span>
                        <input type="email" value={inviteAdminEmail}
                          onChange={event => setInviteAdminEmail(event.target.value)}
                          autoComplete="email" required maxLength={255} />
                      </label>
                      <button type="submit" disabled={working}>
                        {working ? 'Sending…' : 'Send invitation'}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="sa-activity" aria-labelledby="sa-activity-title">
        <div className="sa-list-heading">
          <h2 id="sa-activity-title">Recent activity</h2>
          <span>Last {activity.length}</span>
        </div>
        {activity.length === 0 ? (
          <p className="sa-empty">Platform actions will appear here.</p>
        ) : (
          <ul className="sa-activity-list">
            {activity.map(event => (
              <li key={event.id}>
                <span className="sa-event">
                  <strong>{eventLabel(event)}</strong>
                  <span>
                    {event.organization_name || 'Platform'}
                    {event.actor_email ? ` · ${event.actor_email}` : ''}
                  </span>
                </span>
                <time>{event.created_at ? new Date(event.created_at).toLocaleString() : ''}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function eventLabel(event: AuditEvent) {
  switch (event.action) {
    case 'organization.created':
      return `Created organization · invited ${String(event.details.admin_email || 'first admin')}`;
    case 'organization.status_changed':
      return event.details.is_active ? 'Reactivated organization' : 'Suspended organization';
    case 'admin_invite.resent':
      return `Resent first-admin invitation to ${String(event.details.admin_email || 'admin')}`;
    case 'admin_invite.created':
      return `Invited organization admin ${String(event.details.admin_email || '')}`;
    case 'admin_invite.accepted':
      return `First-admin invitation accepted by ${String(event.details.email || 'admin')}`;
    case 'superadmin.bootstrapped':
      return 'Bootstrapped platform superadmin';
    case 'superadmin.created':
      return 'Created additional platform superadmin';
    default:
      return event.action.split('.').join(' ');
  }
}

const styles = `
.sa {
  --sa-ink: #1d1d1f;
  --sa-muted: #6e6e73;
  --sa-faint: #86868b;
  --sa-line: rgba(0, 0, 0, .09);
  --sa-blue: #0071e3;
  max-width: 1040px;
  margin: 0 auto;
  padding: 64px 28px 104px;
  color: var(--sa-ink);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.sa-header { padding-bottom: 32px; border-bottom: 1px solid var(--sa-line); }
.sa-eyebrow { margin: 0 0 8px; color: var(--sa-blue); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.sa-header h1 { margin: 0; font-size: clamp(36px, 5vw, 52px); letter-spacing: -.035em; }
.sa-subtitle, .sa-section-heading p { margin: 9px 0 0; color: var(--sa-muted); font-size: 17px; line-height: 1.5; }
.sa-create { padding: 32px 0 28px; border-bottom: 1px solid var(--sa-line); }
.sa-section-heading h2, .sa-list-heading h2 { margin: 0; font-size: 21px; letter-spacing: -.02em; }
.sa-form { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; gap: 14px; margin-top: 22px; }
.sa-form label { display: grid; gap: 7px; color: var(--sa-muted); font-size: 13px; }
.sa-form input { box-sizing: border-box; width: 100%; min-height: 42px; padding: 0 12px; border: 1px solid var(--sa-line); border-radius: 9px; color: var(--sa-ink); font: inherit; font-size: 15px; }
.sa-form input:focus { outline: 3px solid rgba(0, 113, 227, .17); border-color: var(--sa-blue); }
.sa-form button { min-height: 42px; padding: 0 18px; border: 0; border-radius: 999px; background: var(--sa-blue); color: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.sa-form button:disabled, .sa-actions button:disabled { opacity: .55; cursor: wait; }
.sa-note { margin: 12px 0 0; color: var(--sa-faint); font-size: 13px; }
.sa-message { margin: 16px 0 0; color: #147a3f; font-size: 14px; }
.sa-message--error { color: #c62828; }
.sa-inline-error { margin: 10px 0 0; color: #c62828; font-size: 13px; }
.sa-list-section { padding-top: 34px; }
.sa-activity { padding-top: 34px; }
.sa-list-heading { display: flex; align-items: center; justify-content: space-between; }
.sa-list-heading > span { color: var(--sa-faint); font-variant-numeric: tabular-nums; }
.sa-empty { margin: 20px 0 0; color: var(--sa-muted); }
.sa-list { list-style: none; margin: 12px 0 0; padding: 0; }
.sa-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 0; border-bottom: 1px solid var(--sa-line); }
.sa-row.is-suspended .sa-org h3 { color: var(--sa-muted); }
.sa-org { display: grid; min-width: 0; gap: 5px; }
.sa-org h3 { margin: 0; font-size: 17px; font-weight: 600; }
.sa-org-meta, .sa-invite-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--sa-muted); font-size: 13px; }
.sa-invite-meta { color: var(--sa-faint); }
.sa-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 16px; }
.sa-status { color: #147a3f; font-size: 13px; font-weight: 600; }
.sa-status--off { color: #c62828; }
.sa-text-button { padding: 6px 0; border: 0; background: none; color: var(--sa-blue); font: inherit; font-size: 13px; cursor: pointer; }
.sa-text-button:hover { text-decoration: underline; }
.sa-invite-form { display: flex; grid-column: 1 / -1; align-items: end; gap: 10px; margin-left: auto; }
.sa-invite-form label { display: grid; gap: 5px; color: var(--sa-muted); font-size: 12px; }
.sa-invite-form input { min-height: 34px; padding: 0 9px; border: 1px solid var(--sa-line); border-radius: 7px; font: inherit; }
.sa-invite-form button { min-height: 34px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--sa-blue); color: white; font: inherit; font-size: 12px; cursor: pointer; }
.sa-invite-form button:disabled { opacity: .55; cursor: wait; }
.sa-activity-list { list-style: none; margin: 12px 0 0; padding: 0; }
.sa-activity-list li { display: flex; justify-content: space-between; gap: 20px; padding: 13px 0; border-bottom: 1px solid var(--sa-line); }
.sa-event { display: grid; gap: 4px; font-size: 13px; }
.sa-event strong { font-weight: 550; }
.sa-event > span, .sa-activity-list time { color: var(--sa-faint); }
.sa-activity-list time { flex: 0 0 auto; font-size: 12px; }
@media (max-width: 700px) {
  .sa { padding: 40px 18px 72px; }
  .sa-form { grid-template-columns: 1fr; }
  .sa-form button { justify-self: start; }
  .sa-row { align-items: flex-start; flex-direction: column; gap: 12px; }
  .sa-actions { flex-wrap: wrap; }
  .sa-invite-form { align-items: stretch; flex-direction: column; width: 100%; margin: 0; }
  .sa-invite-form input { box-sizing: border-box; width: 100%; }
  .sa-invite-form button { align-self: flex-start; }
  .sa-activity-list li { flex-direction: column; gap: 6px; }
}
`;
