import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { AuthLayout } from '../brand.jsx';
import { Icon } from '../icons.jsx';
import { ErrorNote, Field, PageTitle, PasswordField, errText, useSubmit } from '../ui.jsx';
import { DEMO, api } from '../api.js';

export default function Login() {
  const { user, ready, login, sessionExpired } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState(loc.state?.email || '');
  const [password, setPassword] = useState('');
  const [verification, setVerification] = useState(() => (
    loc.state?.needsVerification
      ? { email: loc.state.email || '', emailSent: loc.state.emailSent !== false }
      : null
  ));
  const [resend, setResend] = useState({ busy: false, sent: false, error: null });
  const [cooldown, setCooldown] = useState(0);
  const { busy, error, submit } = useSubmit();

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (ready && user) return <Navigate to={loc.state?.from || '/'} replace />;

  const go = async (e) => {
    e.preventDefault();
    setResend({ busy: false, sent: false, error: null });
    const ok = await submit(async () => {
      try {
        await login(email.trim(), password);
        setVerification(null);
      } catch (err) {
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          // The backend tells us which address is waiting; show the full
          // verification explanation instead of a generic "no access" error.
          setVerification({ email: err.email || email.trim(), emailSent: true });
        }
        throw err;
      }
    });
    if (ok) nav(loc.state?.from || '/', { replace: true });
  };

  const resendVerification = async () => {
    const target = (verification?.email || email).trim();
    if (!target) return;
    setResend({ busy: true, sent: false, error: null });
    try {
      await api('/auth/resend-verification', { method: 'POST', body: { email: target } });
      setResend({ busy: false, sent: true, error: null });
      setCooldown(60);
    } catch (err) {
      setResend({ busy: false, sent: false, error: err });
    }
  };

  const changeEmail = (e) => {
    const next = e.target.value;
    setEmail(next);
    if (verification && next.trim().toLowerCase() !== verification.email.toLowerCase()) {
      setVerification(null);
    }
    if (resend.sent || resend.error) setResend({ busy: false, sent: false, error: null });
  };

  return (
    <AuthLayout>
      <form className="auth" onSubmit={go}>
        <PageTitle>Sign in</PageTitle>
        <h1>Sign in to Telos</h1>
        {sessionExpired && !verification && (
          <div className="note error" role="status">
            Your session expired. Sign in again to continue.
          </div>
        )}
        {verification && (
          <div className="verify-box" role="status" aria-live="polite">
            <div className="verify-head">
              <span className="verify-icon" aria-hidden="true"><Icon name="mail" size={20} /></span>
              <div>
                <strong>Verify your email to continue</strong>
                <p>We sent a verification link to <b>{verification.email || email}</b>.</p>
              </div>
            </div>
            <p className="muted">
              Open the link in that email, then come back and sign in. If it is not there after a
              minute, check your spam or junk folder.
            </p>
            {verification.emailSent === false && (
              <p className="error-text">
                The server could not send the verification email automatically. Try resending
                below; if that fails too, ask the administrator to check the mail settings.
              </p>
            )}
            <button
              type="button"
              className="primary"
              onClick={resendVerification}
              disabled={resend.busy || cooldown > 0}
            >
              {resend.busy
                ? 'Sending…'
                : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : 'Resend verification email'}
            </button>
            {resend.sent && (
              <p className="ok" role="status">If that email belongs to an unverified account, a new link is on its way.</p>
            )}
            {resend.error && <p className="error-text">{errText(resend.error)}</p>}
          </div>
        )}
        <Field label="Email">
          <input
            type="email"
            required
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={changeEmail}
          />
        </Field>
        <PasswordField
          label="Password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="auth-aside">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <ErrorNote error={error && error.code !== 'EMAIL_NOT_VERIFIED' ? error : null} />
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {DEMO && (
          <div className="demo-login">
            <p className="muted">Demo: explore with sample data.</p>
            <div className="row">
              <button type="button" onClick={() => submit(() => login('owner@telos.demo', 'demo')).then((ok) => ok && nav('/'))}>Open as owner</button>
              <button type="button" onClick={() => submit(() => login('member@telos.demo', 'demo')).then((ok) => ok && nav('/'))}>Open as team member</button>
            </div>
          </div>
        )}
        <small className="muted">First deployment? <Link to="/setup">Set up the owner account</Link></small>
      </form>
    </AuthLayout>
  );
}
