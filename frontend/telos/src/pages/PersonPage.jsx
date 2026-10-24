import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadContract, list } from '../api.js';
import { ask } from '../ui.jsx';
import { Badge, Empty, ErrorNote, Field, Loading, PageTitle, fmtDate, isActive, useAsync, useSubmit } from '../ui.jsx';
import AttrEditor, { cleanAttrs, normAttr } from './AttrEditor.jsx';
import { checkPdf, verificationState } from './People.jsx';

export default function PersonPage() {
  const { id } = useParams();
  const state = useAsync(() => api(`/admin/people/${id}`), [id]);
  const roles = useAsync(() => api('/admin/roles'), []);
  const attrs = useAsync(() => api('/admin/attributes'), []);
  const projects = useAsync(() => api('/projects'), []);
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return (<><Link to="/people" className="back">← People</Link><ErrorNote error={state.error} retry={state.reload} /></>);
  const p = state.data.person;
  const emailState = verificationState(p);
  const shared = { roles: list(roles.data, 'roles'), attributes: list(attrs.data, 'attributes'), projects: list(projects.data, 'projects') };

  return (
    <>
      <PageTitle>{p.name}</PageTitle>
      <Link to="/people" className="back">← People</Link>
      <div className="page-head">
        <div className="page-title"><h1>{p.name}</h1><p className="muted">{p.email}</p></div>
        <div className="page-actions">
          {emailState === 'verified'
            ? <Badge kind="done">Email verified</Badge>
            : emailState === 'deferred'
              ? <Badge kind="warn">Verification on hold</Badge>
              : <Badge kind="warn">Email unverified</Badge>}
          {isActive(p.is_active) ? <Badge kind="done">Active</Badge> : <Badge kind="archived">Archived</Badge>}
        </div>
      </div>
      <div className="split">
        <div className="stack">
          <Profile p={p} onSaved={state.reload} />
          <PersonProjects p={p} />
          <Contracts p={p} onSaved={state.reload} />
        </div>
        <div className="stack">
          <EmailVerification p={p} onSaved={state.reload} />
          {p.isOwner ? <div className="card"><h2>Access</h2><p className="muted">The owner has full access to everything.</p></div> : (
            <>
              <RoleEditor p={p} {...shared} onSaved={state.reload} />
              <PersonAttrs p={p} {...shared} onSaved={state.reload} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function EmailVerification({ p, onSaved }) {
  const { busy, error, submit } = useSubmit();
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const state = verificationState(p);
  useEffect(() => {
    setSent(false);
    setCooldown(0);
  }, [p.email]);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const requestVerification = () => submit(async () => {
    await api(`/admin/people/${p.id}/send-verification`, { method: 'POST' });
    setSent(true);
    setCooldown(60);
    onSaved();
  });
  const markVerified = async () => {
    const confirmed = await ask(
      `Mark ${p.email} as verified without the email link? Only do this if you have confirmed this address belongs to ${p.name}.`,
      'Mark verified'
    );
    if (!confirmed) return;
    submit(async () => {
      await api(`/admin/people/${p.id}/verify-email`, { method: 'POST' });
      onSaved();
    });
  };
  return (
    <div className="card">
      <div className="section-head">
        <h2>Email verification</h2>
        {state === 'verified'
          ? <Badge kind="done">Verified</Badge>
          : state === 'deferred'
            ? <Badge kind="warn">On hold</Badge>
            : <Badge kind="warn">Not verified</Badge>}
      </div>
      {state === 'verified' ? (
        <p className="muted">This email address is confirmed. {p.isOwner ? 'The owner can sign in.' : `${p.name} can sign in.`}</p>
      ) : state === 'deferred' ? (
        <>
          <p className="muted">
            Verification is on hold. {p.name} can sign in now, but <strong>{p.email}</strong> has
            not been confirmed. Request verification when you are ready; after that, they
            will need to open the link before signing in again.
          </p>
          <div className="row wrap">
            <button type="button" className="primary" disabled={busy || cooldown > 0} onClick={requestVerification}>
              {busy
                ? 'Sending…'
                : cooldown > 0
                  ? `Request again in ${cooldown}s`
                  : 'Request verification email'}
            </button>
            <button type="button" disabled={busy} onClick={markVerified}>Mark as verified</button>
          </div>
          {sent && !error && <p className="ok mt">Verification email sent to {p.email}.</p>}
          <ErrorNote error={error} />
          <small className="muted">If the email keeps failing, they can keep working while verification stays on hold.</small>
        </>
      ) : (
        <>
          <p className="muted">
            This account cannot sign in until the verification link sent to <strong>{p.email}</strong> is opened.
            Changing the email address later resets verification.
          </p>
          <div className="row wrap">
            <button type="button" className="primary" disabled={busy || cooldown > 0} onClick={requestVerification}>
              {busy
                ? 'Sending…'
                : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : 'Resend verification email'}
            </button>
            <button type="button" disabled={busy} onClick={markVerified}>Mark as verified</button>
          </div>
          {sent && !error && <p className="ok mt">Verification email sent to {p.email}.</p>}
          <ErrorNote error={error} />
          <small className="muted">If the email keeps failing, check the server mail settings before marking the address manually.</small>
        </>
      )}
    </div>
  );
}

function Profile({ p, onSaved }) {
  const [f, setF] = useState({ name: p.name || '', email: p.email || '', phone_number: p.phone_number || '', location: p.location || '', age: p.age ?? '' });
  const { busy, error, submit } = useSubmit();
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  const patch = (body) => submit(async () => { await api(`/admin/people/${p.id}`, { method: 'PATCH', body }); setSaved(true); onSaved(); });
  const save = (e) => {
    e.preventDefault(); setSaved(false);
    patch({ ...f, age: f.age === '' ? null : Number(f.age) });
  };
  const toggle = async () => {
    const archive = isActive(p.is_active);
    if (archive && !(await ask(`Archive ${p.name}? They won't be able to sign in. Their records are kept.`, 'Archive'))) return;
    patch({ is_active: !archive });
  };
  return (
    <form className="card" onSubmit={save}>
      <h2>Profile</h2>
      <div className="two">
        <Field label="Name"><input required autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Email"><input type="email" required autoComplete="email" autoCapitalize="none" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input autoComplete="tel" value={f.phone_number} onChange={set('phone_number')} /></Field>
        <Field label="Location"><input autoComplete="address-level2" value={f.location} onChange={set('location')} /></Field>
        <Field label="Age"><input type="number" min="0" autoComplete="off" value={f.age} onChange={set('age')} /></Field>
      </div>
      <ErrorNote error={error} />
      {saved && !error && <p className="ok" role="status">Saved.</p>}
      <div className="row">
        <button className="primary" disabled={busy}>Save profile</button>
        {!p.isOwner && <button type="button" className={isActive(p.is_active) ? 'danger' : ''} disabled={busy} onClick={toggle}>{isActive(p.is_active) ? 'Archive' : 'Reactivate'}</button>}
      </div>
      {!isActive(p.is_active) && <small className="muted">Reactivating requires a contract with start and end dates.</small>}
    </form>
  );
}

function PersonProjects({ p }) {
  const memberships = p.projectMemberships || [];
  const projectContracts = p.projectContracts || [];
  return (
    <div className="card">
      <h2>Projects &amp; contracts</h2>
      <h3>Projects</h3>
      {memberships.length === 0 ? (
        <Empty className="empty-inline" title="Not in any project yet" mood="normal" />
      ) : (
        <div className="list">
          {memberships.map((membership) => (
            <div className="row-item" key={membership.projectId}>
              <div>
                <Link className="link" to={`/projects/${membership.projectId}?tab=team`}>
                  {membership.projectName}
                </Link>
                <small className="muted block">{membership.departmentName || 'No department'}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="mt">Project contracts</h3>
      {projectContracts.length === 0 ? (
        <Empty className="empty-inline" title="No project contracts yet" mood="happy" />
      ) : (
        <div className="list">
          {projectContracts.map((contract) => (
            <div className="row-item" key={contract.id}>
              <div>
                <div className="row wrap">
                  <strong>{contract.projectName}</strong>
                  {contract.source === 'uploaded'
                    ? <Badge kind="done">Signed</Badge>
                    : <Badge kind="warn">Not signed</Badge>}
                </div>
                <small className="muted block">
                  {fmtDate(contract.startDate)}{contract.endDate ? ` – ${fmtDate(contract.endDate)}` : ' · open-ended'}
                </small>
              </div>
              <div className="row">
                {contract.hasPdf && (
                  <a className="link" href={`/api/projects/${contract.projectId}/contracts/${contract.id}/file/pdf`} download>
                    PDF
                  </a>
                )}
                {contract.hasWord && (
                  <a className="link" href={`/api/projects/${contract.projectId}/contracts/${contract.id}/file/word`} download>
                    Word
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Contracts({ p, onSaved }) {
  const [adding, setAdding] = useState(false);
  const [dates, setDates] = useState({ contract_start_date: '', contract_end_date: '', contract_terms: '' });
  const [file, setFile] = useState(null);
  const { busy, error, submit, setError } = useSubmit();
  const dl = useSubmit();
  const contracts = [...(p.contracts || [])].sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  const upload = (e) => {
    e.preventDefault();
    const problem = checkPdf(file) ||
      (dates.contract_end_date && dates.contract_end_date < dates.contract_start_date
        ? 'The end date cannot be before the start date.'
        : null);
    if (problem) return setError(new Error(problem));
    const fd = new FormData();
    Object.entries(dates).forEach(([k, v]) => v && fd.append(k, v));
    fd.append('contract', file);
    submit(async () => { await api(`/admin/people/${p.id}/contracts`, { method: 'POST', form: fd }); setAdding(false); setFile(null); onSaved(); });
  };
  return (
    <div className="card">
      <div className="section-head"><h2>Terms</h2><button onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add terms'}</button></div>
      <p className="muted">
        The studio-wide terms every person signs to come aboard. Their project contracts
        are listed above, under Projects &amp; contracts.
      </p>
      <ErrorNote error={dl.error} />
      <div className="list">
        {contracts.length === 0 && <Empty className="empty-inline" title="No terms uploaded" mood="happy" />}
        {contracts.map((c) => (
          <div className="row-item" key={c.id}>
            <div><strong>{fmtDate(c.start_date)}{c.end_date ? ` – ${fmtDate(c.end_date)}` : ' · open-ended'}</strong>
              <small className="muted block">{c.original_name || 'Terms.pdf'}{c.terms ? ` · ${c.terms}` : ''}</small></div>
            <button className="link" disabled={dl.busy} onClick={() => dl.submit(() => downloadContract(c))}>Download</button>
          </div>
        ))}
      </div>
      {adding && (
        <form className="mt" onSubmit={upload}>
          <div className="two">
            <Field label="Start date"><input type="date" required value={dates.contract_start_date} onChange={(e) => setDates({ ...dates, contract_start_date: e.target.value })} /></Field>
            <Field label="End date" hint="Leave empty when it runs open-ended.">
              <input type="date" value={dates.contract_end_date} onChange={(e) => setDates({ ...dates, contract_end_date: e.target.value })} />
            </Field>
          </div>
          <Field label="Terms PDF" hint="PDF, up to 10 MB."><input type="file" accept="application/pdf,.pdf" required onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
          <Field label="Notes (optional)"><textarea rows={2} value={dates.contract_terms} onChange={(e) => setDates({ ...dates, contract_terms: e.target.value })} /></Field>
          <ErrorNote error={error} />
          <button className="primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload terms'}</button>
        </form>
      )}
    </div>
  );
}

function RoleEditor({ p, roles, projects, onSaved }) {
  const toRows = () => (p.roles || []).filter((r) => (r.name ?? r) !== 'owner').map((r) =>
    typeof r === 'string' ? { name: r, resourceId: null } : { name: r.name, resourceId: r.resourceType === 'project' ? r.resourceId : null });
  const [rows, setRows] = useState(toRows);
  useEffect(() => setRows(toRows()), [p]); // eslint-disable-line
  const [pick, setPick] = useState('');
  const [scope, setScope] = useState('');
  const selectedRole = roles.find((r) => r.name === pick);
  const requiresProject = !!selectedRole?.accessPreset;
  const { busy, error, submit } = useSubmit();
  const save = () => submit(async () => {
    // PUT replaces the whole list, so send every role that should remain.
    const body = rows.map((r) => r.resourceId ? { name: r.name, resourceType: 'project', resourceId: Number(r.resourceId) } : r.name);
    await api(`/admin/people/${p.id}/roles`, { method: 'PUT', body: { roles: body } });
    onSaved();
  });
  const projName = (id) => projects.find((x) => String(x.id) === String(id))?.name || `Project ${id}`;
  return (
    <div className="card">
      <h2>Roles</h2>
      <div className="list">
        {rows.length === 0 && <p className="muted">No roles.</p>}
        {rows.map((r, i) => (
          <div className="row-item" key={i}>
            <span><strong>{r.name}</strong> <small className="muted">{r.resourceId ? `only ${projName(r.resourceId)}` : 'all projects'}</small></span>
            <button className="link danger-text" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
      </div>
      <div className="row wrap mt">
        <select aria-label="Role" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose role</option>
          {roles.filter((r) => r.name !== 'owner').map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        </select>
        <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">{requiresProject ? 'Choose project' : 'All projects'}</option>
          {projects.map((x) => <option key={x.id} value={x.id}>Only {x.name}</option>)}
        </select>
        <button
          disabled={!pick || (requiresProject && !scope)}
          onClick={() => { setRows([...rows, { name: pick, resourceId: scope || null }]); setPick(''); setScope(''); }}
        >
          Add
        </button>
      </div>
      {requiresProject && <p className="muted">This role uses a project access preset, so choose the project it applies to.</p>}
      <ErrorNote error={error} />
      <button className="primary mt" disabled={busy} onClick={save}>Save roles</button>
    </div>
  );
}

function PersonAttrs({ p, attributes, projects, onSaved }) {
  const [rows, setRows] = useState(() => (p.attributes || []).map(normAttr));
  useEffect(() => setRows((p.attributes || []).map(normAttr)), [p]);
  const { busy, error, submit } = useSubmit();
  const save = () => submit(async () => {
    await api(`/admin/people/${p.id}/attributes`, { method: 'PUT', body: { attributes: cleanAttrs(rows) } });
    onSaved();
  });
  return (
    <div className="card">
      <h2>Extra permissions</h2>
      <p className="muted">Grant or block individual attributes on top of this person's roles.</p>
      <AttrEditor value={rows} onChange={setRows} attributes={attributes} projects={projects} withMode />
      <ErrorNote error={error} />
      <button className="primary mt" disabled={busy} onClick={save}>Save permissions</button>
    </div>
  );
}
