import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { AuthLayout } from '../brand.jsx';
import { ErrorNote, Field, PageTitle, useSubmit } from '../ui.jsx';

export default function ForgotPassword() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit();

  const go = async (e) => {
    e.preventDefault();
    const ok = await submit(() => api('/auth/forgot-password', {
      method: 'POST',
      body: { email: email.trim() }
    }));
    if (ok) setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout>
        <div className="auth" role="status" aria-live="polite">
          <PageTitle>Check your email</PageTitle>
          <h1>Check your email</h1>
          <p>
            If an account exists for <b>{email}</b>, we have sent a link to reset the password.
          </p>
          <p className="muted">
            The link expires in 1 hour and can only be used once. If it does not arrive after a
            minute, check your spam or junk folder.
          </p>
          <button type="button" className="primary" onClick={() => nav('/login')}>Back to sign in</button>
          <small className="muted">
            Still stuck? Ask the owner to check the server mail settings.
          </small>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth" onSubmit={go}>
        <PageTitle>Reset password</PageTitle>
        <h1>Reset your password</h1>
        <p className="muted">
          Enter the email address on your account and we will email you a reset link.
        </p>
        <Field label="Email">
          <input
            type="email"
            required
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
        <small className="muted"><Link to="/login">Back to sign in</Link></small>
      </form>
    </AuthLayout>
  );
}
