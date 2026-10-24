import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Empty, ErrorNote, Progress } from '../ui.jsx';
import { SCHEDULE } from '../schedule.js';

// How many rows a group shows before it says "and N more".
const LIMIT = 8;

const BUCKETS = [
  { key: 'overdue', title: 'Overdue', note: 'The end date has passed and the work is not finished.', kind: 'danger' },
  { key: 'due_soon', title: 'Due this week', note: 'Still open, and the deadline is close.', kind: 'warn' },
  { key: 'unassigned', title: 'Unassigned', note: 'Nobody owns this yet.', kind: 'muted' },
  { key: 'blocked', title: 'Blocked', note: 'Waiting on a task that is not finished.', kind: 'progress' },
  { key: 'stale', title: 'No movement', note: 'Started, but nothing has changed for a week.', kind: 'muted' }
];

export default function Attention({ projectId, state }) {
  const [expanded, setExpanded] = useState(false);
  const attention = (state && state.data && state.data.attention) || {};
  const total = BUCKETS.reduce((sum, bucket) => sum + ((attention[bucket.key] || []).length), 0);

  return (
    <div className="attention">
      {total === 0 && !state.loading && (
        <Empty title="Nothing needs attention" mood="happy">
          No overdue work, nothing due this week, and nothing waiting on someone else.
        </Empty>
      )}
      {BUCKETS.map((bucket) => {
        const items = attention[bucket.key] || [];
        if (items.length === 0) return null;
        const shown = expanded ? items : items.slice(0, LIMIT);
        const projects = [...new Set(items.map((item) => item.project_name).filter(Boolean))];
        return (
          <section className="attention-group" key={bucket.key}>
            <header>
              <h2>
                <Badge kind={bucket.kind}>{items.length}</Badge>
                {bucket.title}
                {bucket.key === 'overdue' && <img className="attention-face" src="/paperman-sad.png" alt="" aria-hidden="true" />}
              </h2>
              <p className="muted">{bucket.note}</p>
              {projects.length > 1 && <p className="muted attention-projects">Across {projects.length} projects</p>}
            </header>
            <div className="list">
              {shown.map((task) => (
                <Link className="attention-row" to={`/projects/${projectId}?tab=tasks&task=${task.id}`} key={task.id}>
                  <span className="attention-title">{task.title}</span>
                  <span className="attention-meta">
                    {task.due && <span className="muted">{task.due.relative}</span>}
                    {task.assignees && task.assignees.length > 0
                      ? <span className="muted">{task.assignees.map((a) => a.name).join(', ')}</span>
                      : <span className="muted">Unassigned</span>}
                    {task.blocked && task.blocked.length > 0 && (
                      <span className="muted">waiting on {task.blocked.length}</span>
                    )}
                  </span>
                  <Progress value={task.progress} />
                </Link>
              ))}
            </div>
            {items.length > LIMIT && (
              <button type="button" className="attention-more" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Show fewer' : `and ${items.length - LIMIT} more`}
              </button>
            )}
          </section>
        );
      })}
      {state.error && <ErrorNote error={state.error} retry={state.reload} />}
    </div>
  );
}
