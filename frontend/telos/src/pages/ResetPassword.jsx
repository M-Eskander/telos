import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { AuthLayout } from '../brand.jsx';
import { ErrorNote, PageTitle, PasswordField, useSubmit } from '../ui.jsx';

const MIN_PASSWORD = 8;

export default function ResetPassword() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [f, setF] = useState({ password: '', confirm: '' });
  const [done, setDone] = useState(false);
  const { busy, error, submit, setError } = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const go = async (e) => {
    e.preventDefault();
    if (f.password.length < MIN_PASSWORD) {
      return setError(new Error(`Choose a password with at least ${MIN_PASSWORD} characters.`));
    }
    if (f.password !== f.confirm) {
      return setError(new Error('The passwords do not match.'));
    }
    const ok = await submit(() => api('/auth/reset-password', {
      method: 'POST',
      body: { token, new_password: f.password }
    }));
    if (ok) setDone(true);
  };

  if (!token) {
    return (
      <AuthLayout>
        <div className="auth">
          <PageTitle>Reset link incomplete</PageTitle>
          <h1>Reset link incomplete</h1>
          <p>This page needs the full link from your email. Copy the whole address or request a new one.</p>
          <button type="button" className="primary" onClick={() => nav('/forgot-password')}>Request a new link</button>
        </div>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <div className="auth" role="status" aria-live="polite">
          <PageTitle>Password updated</PageTitle>
          <h1>Password updated</h1>
          <p>You can now sign in with your new password. Any other devices have been signed out.</p>
          <button type="button" className="primary" onClick={() => nav('/login')}>Go to sign in</button>
        </div>
      </AuthLayout>
    );
  }

  const linkProblem = error?.code === 'INVALID_TOKEN' || error?.code === 'TOKEN_EXPIRED';

  return (
    <AuthLayout>
      <form className="auth" onSubmit={go}>
        <PageTitle>Choose a new password</PageTitle>
        <h1>Choose a new password</h1>
        <p className="muted">Enter a new password for your Telos account. The link can only be used once.</p>
        <PasswordField
          label="New password"
          required
          minLength={MIN_PASSWORD}
          autoFocus
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          value={f.password}
          onChange={set('password')}
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
        {linkProblem && (
          <small className="muted">
            <Link to="/forgot-password">Request a new reset link</Link>
          </small>
        )}
        <button className="primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        <small className="muted"><Link to="/login">Back to sign in</Link></small>
      </form>
    </AuthLayout>
  );
}
