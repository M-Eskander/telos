import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, ErrorNote, Loading, Progress, useAsync } from '../ui.jsx';

const UNASSIGNED_LIMIT = 8;

// Who is working on what: the people of a project and the work on their plate.
export default function ProjectWork({ projectId }) {
  const state = useAsync(() => api(`/projects/${projectId}/work`), [projectId]);
  const [showAll, setShowAll] = useState(false);
  if (state.loading && !state.data) return <Loading label="Reading the room…" />;
  if (state.error) return <ErrorNote error={state.error} retry={state.reload} />;

  const people = state.data?.people || [];
  const unassigned = state.data?.unassigned || [];
  const shownUnassigned = showAll ? unassigned : unassigned.slice(0, UNASSIGNED_LIMIT);

  return (
    <div>
      <div className="section-head work-head">
        <h2>Who is working on what</h2>
        <span className="muted">{state.data?.total || 0} open tasks</span>
      </div>
      <p className="muted">Everyone in the project, with the work that is on their plate right now.</p>

      {people.length === 0 ? (
        <Empty title="Nobody in this project yet" mood="happy">
          Add the team under Team, and their work will show up here.
        </Empty>
      ) : (
        <div className="work-grid">
          {people.map((person) => (
            <div className="card work-card" key={person.id}>
              <div className="between">
                <div>
                  <strong>{person.name}</strong>
                  <small className="muted block">{person.department || 'No department'}</small>
                </div>
                <span className="work-load">{person.load}</span>
              </div>
              {person.tasks.length === 0 ? (
                <p className="muted">Nothing on their plate.</p>
              ) : (
                <div className="list tight">
                  {person.tasks.map((task) => (
                    <Link className="row-item" key={task.id} to={`/projects/${projectId}?tab=tasks&task=${task.id}`}>
                      <div>
                        <strong>{task.title}</strong>
                        <Progress value={task.progress} />
                      </div>
                      <span className={`chip chip-${task.schedule}`}>{task.schedule.replace('_', ' ')}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {unassigned.length > 0 && (
        <>
          <div className="section-head mt">
            <h2>Nobody is on these <span className="muted">({unassigned.length})</span></h2>
            {unassigned.length > UNASSIGNED_LIMIT && (
              <button className="link" onClick={() => setShowAll((value) => !value)}>
                {showAll ? 'Show fewer' : `Show all ${unassigned.length}`}
              </button>
            )}
          </div>
          <div className="list">
            {shownUnassigned.map((task) => (
              <Link className="row-item" key={task.id} to={`/projects/${projectId}?tab=tasks&task=${task.id}`}>
                <div>
                  <strong>{task.title}</strong>
                  <small className="muted block">{task.progress}%</small>
                </div>
                <span className={`chip chip-${task.schedule}`}>{task.schedule.replace('_', ' ')}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
