import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, list } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { Icon } from '../icons.jsx';
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, Panel, Progress, useAsync, useSubmit } from '../ui.jsx';

export default function Projects() {
  const { user } = useAuth();
  const canCreate = can(user, 'create:project');
  const state = useAsync(() => api('/projects'), []);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState('cards');
  const searchRef = useRef(null);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener('telos:focus-search', focus);
    return () => window.removeEventListener('telos:focus-search', focus);
  }, []);
  const all = list(state.data, 'projects');
  const projects = all.filter((p) =>
    `${p.name} ${p.description || ''}`.toLowerCase().includes(q.toLowerCase()));
  // The table earns its place once there is more than one project to compare.
  const showTable = view === 'table' && all.length > 0;

  return (
    <>
      <PageTitle>Projects</PageTitle>
      <div className="page-head projects-head">
        <div className="page-title">
          <h1>Projects</h1>
        </div>
        <div className="page-actions">
          {canCreate && (
            <button className="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={17} />
              New project
            </button>
          )}
        </div>
      </div>
      <div className="projects-filter">
        <div className="search-field">
          <Icon name="search" size={17} />
          <input ref={searchRef} type="search" aria-label="Search projects" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {all.length > 0 && (
          <div className="chips" role="group" aria-label="Project view">
            <button className={view === 'cards' ? 'on' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>Cards</button>
            <button className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>Portfolio</button>
          </div>
        )}
      </div>
      <Panel state={state}>
        {projects.length === 0 ? (
          <Empty
            className="projects-empty"
            mood={q ? 'normal' : 'happy'}
            title={q ? 'No projects match your search' : 'No projects yet'}
            action={q
              ? <button onClick={() => setQ('')}>Clear search</button>
              : canCreate
                ? <button className="primary" onClick={() => setCreating(true)}>Create your first project</button>
                : null}
          >
            {q
              ? 'Try a different name or description.'
              : canCreate
                ? 'Create a project to start planning tasks and staffing.'
                : 'When someone adds you to a project, it will appear here.'}
          </Empty>
        ) : showTable ? (
          <div className="table-wrap">
            <table className="portfolio">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Next deadline</th>
                  <th scope="col">Attention</th>
                  <th scope="col">Tasks</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const summary = p.summary || {};
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/projects/${p.id}`}><strong>{p.name}</strong></Link>
                        <span className="muted block clamp">{p.description || 'No description'}</span>
                      </td>
                      <td>
                        <Progress value={p.progress} />
                      </td>
                      <td>
                        {summary.nextDeadline
                          ? (
                            <>
                              <span className="block">{summary.nextDeadline.title}</span>
                              <span className="muted">{summary.nextDeadline.end_date}</span>
                            </>
                          )
                          : <span className="muted">Nothing scheduled</span>}
                      </td>
                      <td>
                        {summary.attention !== undefined && summary.attention !== null
                          ? summary.attention > 0
                            ? (
                            <span className="portfolio-flags">
                              {summary.overdue > 0 && <span className="chip chip-overdue">{summary.overdue} overdue</span>}
                              {summary.dueSoon > 0 && <span className="chip chip-due_soon">{summary.dueSoon} due soon</span>}
                              {summary.atRisk > 0 && <span className="chip chip-at_risk">{summary.atRisk} at risk</span>}
                            </span>
                          )
                            : <span className="chip chip-on_track">On track</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td className="muted">{summary.finished ?? 0}/{summary.total ?? 0} done</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="card project">
                <h3>{p.name}</h3>
                <p className="muted clamp">{p.description || 'No description'}</p>
                <Progress value={p.progress} />
                {p.summary && p.summary.attention > 0 && (
                  <p className="project-flags">
                    {p.summary.overdue > 0 && <span className="chip chip-overdue">{p.summary.overdue} overdue</span>}
                    {p.summary.dueSoon > 0 && <span className="chip chip-due_soon">{p.summary.dueSoon} due soon</span>}
                    {p.summary.atRisk > 0 && <span className="chip chip-at_risk">{p.summary.atRisk} at risk</span>}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </Panel>
      {creating && canCreate && <NewProject onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProject({ onClose }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const { busy, error, submit } = useSubmit();
  const go = (e) => {
    e.preventDefault();
    submit(async () => {
      const r = await api('/projects', { method: 'POST', body: { name: name.trim(), description: description.trim() || null } });
      nav(`/projects/${r.project.id}`);
    });
  };
  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={go}>
        <Field label="Name"><input required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <ErrorNote error={error} />
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Create project</button></footer>
      </form>
    </Modal>
  );
}
