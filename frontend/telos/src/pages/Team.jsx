import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, list } from '../api.js';
import { ask } from '../ui.jsx';
import { useAuth } from '../auth.jsx';
import {
  Badge, Empty, ErrorNote, Field, Panel, errText, isActive, useAsync, useSubmit
} from '../ui.jsx';

export default function Team({ projectId, members, departments, onChange, canManage = false }) {
  const { user } = useAuth();
  const deps = list(departments.data, 'departments');
  const mem = list(members.data, 'members');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const { busy, error, submit } = useSubmit();
  const act = (fn) => submit(async () => { await fn(); onChange(); });

  const addDept = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    act(() => api(`/projects/${projectId}/departments`, { method: 'POST', body: { name: name.trim() } })).then((ok) => ok && setName(''));
  };
  const move = (m, v) => act(() => api(`/projects/${projectId}/members/${m.userId}`, { method: 'PUT', body: { departmentId: v ? Number(v) : null } }));
  const removeMember = async (m) => (await ask(`Remove ${m.name} from this project? Their task assignments here will be removed too.`, 'Remove')) &&
    act(() => api(`/projects/${projectId}/members/${m.userId}`, { method: 'DELETE' }));
  const removeDept = async (d) => (await ask(`Remove the "${d.name}" department? Its members stay in the project without a department.`, 'Remove')) &&
    act(() => api(`/projects/${projectId}/departments/${d.id}`, { method: 'DELETE' }));

  return (
    <div className="split team">
      <section>
        <div className="page-head section-head">
          <h2>Members</h2>
          {canManage && (
            <button className="primary" onClick={() => setAdding((value) => !value)}>
              {adding ? 'Close' : 'Add person'}
            </button>
          )}
        </div>
        {canManage && adding && (
          <AddMember
            projectId={projectId}
            members={mem}
            deps={deps}
            onAdded={() => { setAdding(false); onChange(); }}
          />
        )}
        <ErrorNote error={error} />
        <Panel state={members} empty={mem.length === 0 ? <Empty title="No members yet" mood="happy">{canManage ? 'Add people with the Add person button.' : 'Ask a project manager to add people.'}</Empty> : null}>
          <div className="list">
            {mem.map((m) => (
              <div className="row-item team-member-row" key={m.userId}>
                <div>
                  <strong>{m.name}</strong>
                  <small className="muted block">{m.email}</small>
                  {m.phoneNumber && <small className="muted block">{m.phoneNumber}</small>}
                  <div className="inline-action">
                    {m.hasProjectContract ? (
                      <Badge kind="done">Project contract</Badge>
                    ) : (
                      <>
                        <Badge kind="warn">No project contract</Badge>
                        {canManage && <AttachContract projectId={projectId} member={m} onUploaded={onChange} />}
                      </>
                    )}
                  </div>
                </div>
                {canManage ? (
                  <div className="row">
                    <select aria-label={`Department for ${m.name}`} value={m.departmentId ?? ''} disabled={busy} onChange={(e) => move(m, e.target.value)}>
                      <option value="">No department</option>
                      {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    {user.isOwner && <Link className="link" to={`/people/${m.userId}`}>Profile</Link>}
                    <button className="link danger-text" disabled={busy} onClick={() => removeMember(m)}>Remove</button>
                  </div>
                ) : (
                  <span className="muted">{deps.find((d) => d.id === m.departmentId)?.name || 'No department'}</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </section>
      <section>
        <h2>Departments</h2>
        <Panel state={departments} empty={deps.length === 0 ? <p className="muted">No departments yet.</p> : null}>
          <div className="list">
            {deps.map((d) => (
              <div className="row-item" key={d.id}>
                <span>{d.name} <small className="muted">({mem.filter((m) => m.departmentId === d.id).length})</small></span>
                {canManage && <button className="link danger-text" disabled={busy} onClick={() => removeDept(d)}>Remove</button>}
              </div>
            ))}
          </div>
        </Panel>
        {canManage && (
          <form className="row mt" onSubmit={addDept}>
            <input placeholder="New department name" aria-label="New department name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="primary" disabled={busy}>Add</button>
          </form>
        )}
      </section>
    </div>
  );
}

function AddMember({ projectId, members, deps, onAdded }) {
  const people = useAsync(() => api(`/projects/${projectId}/available-people`), [projectId]);
  const [userId, setUserId] = useState('');
  const [dept, setDept] = useState('');
  const [file, setFile] = useState(null);
  const fileInput = useRef(null);
  const { busy, error, submit, setError } = useSubmit();
  const taken = new Set(members.map((m) => m.userId));
  const options = list(people.data, 'people').filter((p) => isActive(p.is_active) && !taken.has(p.id));
  const add = (e) => {
    e.preventDefault();
    if (!userId) return;
    if (!file) {
      setError(new Error('Choose the project contract PDF for this person.'));
      return;
    }
    submit(async () => {
      const form = new FormData();
      form.append('userId', userId);
      if (dept) form.append('departmentId', dept);
      form.append('contract', file);
      await api(`/projects/${projectId}/members`, { method: 'POST', form });
      setUserId(''); setDept(''); setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      onAdded();
    });
  };
  return (
    <form className="card mt" onSubmit={add}>
      <h3>Add a person</h3>
      {people.error ? <ErrorNote error={people.error} retry={people.reload} /> : (
        <div className="two">
          <Field label="Person">
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{people.loading ? 'Loading…' : options.length ? 'Choose a person' : 'Everyone active is already a member'}</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">No department</option>
              {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      <Field
        label="Project contract PDF"
        hint="Required. This contract is attached to the person and kept in this project's Contracts tab."
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          required
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </Field>
      <ErrorNote error={error} />
      <button className="primary" disabled={busy || !userId || !file}>Add to project</button>
    </form>
  );
}

function AttachContract({ projectId, member, onUploaded }) {
  const input = useRef(null);
  const { busy, error, submit } = useSubmit();
  const upload = (e) => {
    const target = e.target;
    const file = target.files?.[0];
    if (!file) return;
    // Reset the picker now so a failed upload can choose the same file again.
    target.value = '';
    submit(async () => {
      const form = new FormData();
      form.append('contract', file);
      await api(`/projects/${projectId}/members/${member.userId}/contract`, {
        method: 'POST',
        form
      });
      onUploaded();
    });
  };
  return (
    <>
      <button type="button" className="link" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : 'Add contract'}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={upload}
      />
      {error && <small className="error-text" title={errText(error)}>Upload failed</small>}
    </>
  );
}
