import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ask } from '../ui.jsx';
import { ErrorNote, Field, useSubmit } from '../ui.jsx';

export default function ProjectSettings({ project, onSaved, canEdit = false, canDelete = false }) {
  const nav = useNavigate();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [saved, setSaved] = useState(false);
  const { busy, error, submit } = useSubmit();
  const del = useSubmit();

  const save = (e) => {
    e.preventDefault();
    setSaved(false);
    submit(async () => {
      await api(`/projects/${project.id}`, { method: 'PATCH', body: { name: name.trim(), description: description.trim() || null } });
      setSaved(true); onSaved();
    });
  };
  const remove = async () => {
    if (!(await ask(`Delete "${project.name}"? All its tasks, departments and memberships will be permanently removed.`, 'Delete project'))) return;
    del.submit(async () => { await api(`/projects/${project.id}`, { method: 'DELETE' }); nav('/'); });
  };

  return (
    <div className="narrow">
      {canEdit ? (
        <form className="card" onSubmit={save}>
          <h2>Project details</h2>
          <Field label="Name"><input required value={name} onChange={(e) => { setSaved(false); setName(e.target.value); }} /></Field>
          <Field label="Description"><textarea rows={4} value={description} onChange={(e) => { setSaved(false); setDescription(e.target.value); }} /></Field>
          <ErrorNote error={error} />
          {saved && <p className="ok" role="status">Saved.</p>}
          <button className="primary" disabled={busy}>Save changes</button>
        </form>
      ) : (
        <div className="card">
          <h2>Project details</h2>
          <p><strong>{project.name}</strong></p>
          <p className="muted">{project.description || 'No description'}</p>
          <p className="muted">You don't have permission to edit project details.</p>
        </div>
      )}
      {canDelete && (
        <div className="card danger-zone">
          <h2>Delete project</h2>
          <p className="muted">Permanently removes the project and everything in it.</p>
          <ErrorNote error={del.error} />
          <button className="danger" disabled={del.busy} onClick={remove}>Delete project</button>
        </div>
      )}
    </div>
  );
}
