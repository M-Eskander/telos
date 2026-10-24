import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, list } from '../api.js';
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, Panel, PasswordField, errText, fmtDate, isActive, useAsync, useSubmit } from '../ui.jsx';
import { usePresets } from '../presets.js';

export const latestContract = (p) =>
  [...(p.contracts || [])].sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)))[0];

export const verificationState = (p) =>
  p.emailVerificationStatus ||
  (p.emailVerified ? 'verified' : p.emailVerificationDeferred ? 'deferred' : 'pending');

export default function People() {
  const state = useAsync(() => api('/admin/people'), []);
  const { presets } = usePresets();
  const presetLabel = (key) => presets.find((preset) => preset.key === key)?.label || key;
  const [q, setQ] = useState('');
  const [show, setShow] = useState('active');
  const [verification, setVerification] = useState('all');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const allPeople = list(state.data, 'people');
  const pendingVerification = allPeople.filter((p) => verificationState(p) === 'pending').length;
  const onHold = allPeople.filter((p) => verificationState(p) === 'deferred').length;
  const verificationSummary = [
    pendingVerification > 0
      ? `${pendingVerification} email${pendingVerification === 1 ? '' : 's'} still ${pendingVerification === 1 ? 'needs' : 'need'} verification.`
      : '',
    onHold > 0
      ? `${onHold} email${onHold === 1 ? ' is' : 's are'} on hold until you request verification.`
      : ''
  ].filter(Boolean).join(' ');
  const people = allPeople.filter((p) => {
    const state = verificationState(p);
    return (show === 'all' || (show === 'active') === isActive(p.is_active)) &&
      (verification === 'all' ||
        (verification === 'verified' && state === 'verified') ||
        (verification === 'deferred' && state === 'deferred') ||
        (verification === 'unverified' && state === 'pending')) &&
      `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <>
      <PageTitle>People</PageTitle>
      <div className="page-head">
        <div className="page-title">
          <h1>People</h1>
          {verificationSummary && (
            <p className="muted">{verificationSummary}</p>
          )}
        </div>
        <div className="page-actions">
          <input type="search" aria-label="Search people" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Filter">
            <option value="active">Active</option><option value="archived">Archived</option><option value="all">Everyone</option>
          </select>
          <select value={verification} onChange={(e) => setVerification(e.target.value)} aria-label="Email verification">
            <option value="all">All emails</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
            <option value="deferred">On hold</option>
          </select>
          <button className="primary" onClick={() => { setNotice(''); setAdding(true); }}>Add person</button>
        </div>
      </div>
      {notice && <p className="ok" role="status">{notice}</p>}
      <Panel state={state}>
        {people.length === 0 ? (
          <Empty
            mood={allPeople.length === 0 ? 'happy' : 'normal'}
            title={allPeople.length === 0 ? 'No people yet' : 'No people match these filters'}
            action={allPeople.length === 0
              ? <button className="primary" onClick={() => { setNotice(''); setAdding(true); }}>Add your first person</button>
              : <button onClick={() => { setQ(''); setShow('all'); setVerification('all'); }}>Show everyone</button>}
          >
            {allPeople.length === 0 ? 'Add someone with their contract PDF.' : 'Try a different search or filter.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Roles</th><th scope="col">Contract ends</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {people.map((p) => {
                  const c = latestContract(p);
                  const emailState = verificationState(p);
                  return (
                    <tr key={p.id}>
                      <td><Link to={`/people/${p.id}`}><strong>{p.name}</strong></Link></td>
                      <td>
                        <span className="block">{p.email}</span>
                        <div className="inline-action">
                          {emailState === 'verified' ? (
                            <Badge kind="done">Verified</Badge>
                          ) : emailState === 'deferred' ? (
                            <>
                              <Badge kind="warn">On hold</Badge>
                              <ResendVerification
                                person={p}
                                label="Request verification"
                                cooldownLabel="Request again"
                                onSent={state.reload}
                              />
                            </>
                          ) : (
                            <>
                              <Badge kind="warn">Unverified</Badge>
                              <ResendVerification person={p} onSent={state.reload} />
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        {p.isOwner ? 'Owner' : (p.roleAssignments || []).length > 0 ? (
                          <span className="role-list">
                            {p.roleAssignments.map((assignment) => (
                              <span className="role-entry" key={`${assignment.name}-${assignment.resourceId || ''}`}>
                                {assignment.name}
                                {assignment.accessPreset && (
                                  <small className="muted block">{presetLabel(assignment.accessPreset)}</small>
                                )}
                              </span>
                            ))}
                          </span>
                        ) : (p.roles || []).length > 0
                          ? (p.roles || []).join(', ')
                          : <span className="muted">None</span>}
                      </td>
                      <td>{c ? fmtDate(c.end_date) : <span className="muted">No contract</span>}</td>
                      <td>{isActive(p.is_active) ? <Badge kind="done">Active</Badge> : <Badge kind="archived">Archived</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding && (
        <AddPerson
          onClose={() => setAdding(false)}
          onSaved={(person) => {
            setAdding(false);
            state.reload();
            if (person?.verificationEmail?.deferred) {
              setNotice(`${person.name} was added with verification on hold. They can sign in now; request verification later when you're ready.`);
            } else if (person?.verificationEmail?.sent) {
              setNotice(`Person added. A verification email was sent to ${person.email}.`);
            } else if (person?.verificationEmail?.skipped) {
              setNotice('Person added, but email delivery is not configured on the server. Use Resend once it is set up.');
            } else {
              setNotice('Person added, but the verification email could not be sent. Use Resend to try again.');
            }
          }}
        />
      )}
    </>
  );
}

function ResendVerification({ person, label = 'Resend', cooldownLabel = 'Resend', onSent }) {
  const { busy, error, submit } = useSubmit();
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    setSent(false);
    setCooldown(0);
  }, [person.email]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const go = () => submit(async () => {
    await api(`/admin/people/${person.id}/send-verification`, { method: 'POST' });
    setSent(true);
    setCooldown(60);
    onSent?.();
  });

  return (
    <>
      <button type="button" className="link" disabled={busy || cooldown > 0} onClick={go}>
        {busy ? 'Sending…' : cooldown > 0 ? `${cooldownLabel} in ${cooldown}s` : label}
      </button>
      {sent && <small className="ok">Email sent</small>}
      {error && <small className="error-text" title={errText(error)}>Failed</small>}
    </>
  );
}

export const MAX_PDF = 10 * 1024 * 1024;
export function checkPdf(file) {
  if (!file) return 'Choose a contract PDF.';
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'The contract must be a PDF.';
  if (file.size > MAX_PDF) return 'The PDF must be 10 MB or smaller.';
  return null;
}

function AddPerson({ onClose, onSaved }) {
  const [f, setF] = useState({ name: '', email: '', phone_number: '', password: '', location: '', age: '', contract_start_date: '', contract_end_date: '', contract_terms: '', skip_verification: false });
  const [file, setFile] = useState(null);
  const { busy, error, submit, setError } = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = (e) => {
    e.preventDefault();
    const problem = checkPdf(file) ||
      (f.contract_end_date && f.contract_end_date < f.contract_start_date
        ? 'The contract end date cannot be before the start date.'
        : null);
    if (problem) return setError(new Error(problem));
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => {
      if (v === '' || v === false) return;
      fd.append(k, v === true ? 'true' : v);
    });
    fd.append('contract', file);
    submit(async () => {
      const response = await api('/admin/people', { method: 'POST', form: fd });
      onSaved(response.person);
    });
  };
  return (
    <Modal title="Add person" onClose={onClose} wide>
      <form onSubmit={go}>
        <p className="muted">
          Upload the terms they sign to join the studio. Their project contracts are
          attached when you add them to a project, or made from a project's sheet.
        </p>
        <div className="two">
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
          <Field label="Location"><input value={f.location} onChange={set('location')} /></Field>
          <Field label="Age"><input type="number" min="0" value={f.age} onChange={set('age')} /></Field>
        </div>
        <h3>Terms of joining</h3>
        <div className="two">
          <Field label="Start date"><input type="date" required value={f.contract_start_date} onChange={set('contract_start_date')} /></Field>
          <Field label="End date" hint="Leave empty when it runs open-ended.">
            <input type="date" value={f.contract_end_date} onChange={set('contract_end_date')} />
          </Field>
        </div>
        <Field label="Terms PDF" hint="PDF, up to 10 MB."><input type="file" accept="application/pdf,.pdf" required onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <Field label="Terms notes (optional)"><textarea rows={2} value={f.contract_terms} onChange={set('contract_terms')} /></Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={f.skip_verification}
            onChange={(e) => setF({ ...f, skip_verification: e.target.checked })}
          />
          <span>
            <strong>Do not ask for email verification yet.</strong>
            <small className="muted block">
              They can sign in now. Their email stays unverified and shows as
              on hold; you can request verification later from their page.
            </small>
          </span>
        </label>
        <ErrorNote error={error} />
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Uploading…' : 'Add person'}</button></footer>
      </form>
    </Modal>
  );
}
