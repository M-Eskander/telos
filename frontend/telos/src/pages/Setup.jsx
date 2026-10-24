import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { AuthLayout } from '../brand.jsx';
import { ErrorNote, Field, PageTitle, PasswordField, useSubmit } from '../ui.jsx';

export default function Setup() {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', phone_number: '', password: '', setup_secret: '' });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async (e) => {
    e.preventDefault();
    let result;
    const ok = await submit(async () => {
      result = await api('/auth/bootstrap-owner', { method: 'POST', body: f });
    });
    if (!ok) return;
    // The owner is not exempt from verification. Send them to sign-in with
    // the "check your email" panel already open.
    nav('/login', {
      replace: true,
      state: {
        email: f.email.trim(),
        needsVerification: true,
        emailSent: result?.verificationEmail?.sent !== false
      }
    });
  };
  return (
    <AuthLayout>
      <form className="auth" onSubmit={go}>
        <PageTitle>Owner setup</PageTitle>
        <h1>Create the owner account</h1>
        <p className="muted">One-time setup, run by whoever deploys Telos. You need the setup secret from the server configuration.</p>
        <p className="muted">After creating the owner, we will email a verification link. You must open it before you can sign in.</p>
        <Field label="Name"><input required autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Email"><input type="email" required autoComplete="email" autoCapitalize="none" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input required autoComplete="tel" value={f.phone_number} onChange={set('phone_number')} /></Field>
        <PasswordField
          label="Password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters."
          value={f.password}
          onChange={set('password')}
        />
        <Field label="Setup secret"><input type="password" required value={f.setup_secret} onChange={set('setup_secret')} /></Field>
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create owner'}</button>
        <small><Link to="/login">Back to sign in</Link></small>
      </form>
    </AuthLayout>
  );
}
