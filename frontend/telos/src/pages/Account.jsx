import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { usePresets } from '../presets.js';
import { Badge, ErrorNote, PageTitle, PasswordField, useSubmit } from '../ui.jsx';

const MIN_PASSWORD = 8;

// The access level carried by each of the person's roles.
function accessLevel(user, presets) {
  const assignments = user.roleAssignments || [];
  const levels = assignments
    .map((assignment) => presets.find((preset) => preset.key === assignment.accessPreset))
    .filter(Boolean)
    .map((preset) => preset.label);
  return [...new Set(levels)];
}

export default function Account() {
  const { user } = useAuth();
  const { presets } = usePresets();
  const accessLevels = accessLevel(user, presets);
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [done, setDone] = useState('');
  const { busy, error, submit, setError } = useSubmit();
  const set = (k) => (e) => {
    setDone('');
    setF({ ...f, [k]: e.target.value });
  };

  const go = async (e) => {
    e.preventDefault();
    if (f.new_password.length < MIN_PASSWORD) {
      return setError(new Error(`Choose a password with at least ${MIN_PASSWORD} characters.`));
    }
    if (f.new_password !== f.confirm) {
      return setError(new Error('The new passwords do not match.'));
    }
    const ok = await submit(() => api('/auth/change-password', {
      method: 'POST',
      body: { current_password: f.current_password, new_password: f.new_password }
    }));
    if (!ok) return;
    setF({ current_password: '', new_password: '', confirm: '' });
    setDone('Your password has been updated. Any other devices have been signed out.');
  };

  return (
    <>
      <PageTitle>Account</PageTitle>
      <div className="page-head">
        <div className="page-title">
          <h1>Account</h1>
          <p className="muted intro">Your profile and sign-in details.</p>
        </div>
      </div>
      <div className="split">
        <section className="card">
          <h2>Profile</h2>
          <div className="account-meta">
            <div><span className="muted">Name</span><strong>{user.name}</strong></div>
            <div>
              <span className="muted">Email</span>
              <span>
                <strong>{user.email}</strong>{' '}
                {user.emailVerified
                  ? <Badge kind="done">Verified</Badge>
                  : user.emailVerificationDeferred
                    ? <Badge kind="warn">Verification on hold</Badge>
                    : <Badge kind="warn">Unverified</Badge>}
                {user.emailVerificationDeferred && (
                  <small className="muted block">
                    Verification has not been requested yet. You can keep working.
                  </small>
                )}
              </span>
            </div>
            <div>
              <span className="muted">Access</span>
              <strong>{user.isOwner ? 'Owner' : (user.roles || []).join(', ') || 'Member'}</strong>
              {accessLevels.length > 0 && (
                <small className="muted block">{accessLevels.join(' · ')}</small>
              )}
            </div>
          </div>
          <p className="muted">This is the email you use to sign in and recover your password.</p>
        </section>
        <form className="card" onSubmit={go}>
          <h2>Change password</h2>
          <p className="muted">
            Use at least {MIN_PASSWORD} characters. Changing your password signs you out on your
            other devices; this one stays signed in.
          </p>
          <PasswordField
            label="Current password"
            required
            autoComplete="current-password"
            value={f.current_password}
            onChange={set('current_password')}
          />
          <PasswordField
            label="New password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            value={f.new_password}
            onChange={set('new_password')}
          />
          <PasswordField
            label="Confirm new password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            value={f.confirm}
            onChange={set('confirm')}
          />
          <ErrorNote error={error} />
          {done && <p className="ok" role="status">{done}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>
      </div>
    </>
  );
}
