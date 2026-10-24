import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, ErrorNote, Loading, PageTitle, Progress, useAsync } from '../ui.jsx';
import { dueLabel, scheduleState } from '../schedule.js';
import { addLocalDays, localDateKey } from '../date-utils.js';

// The desk of a person: what is theirs, across every project, and the
// meetings of the week.
export default function Home() {
  const work = useAsync(() => api('/me/work'), []);
  const data = work.data;
  const [showDone, setShowDone] = useState(false);

  if (work.loading && !work.data) return <Loading label="Gathering your work…" />;
  if (work.error) return <ErrorNote error={work.error} retry={work.reload} />;

  const tasks = data?.tasks || [];
  const late = tasks.filter((task) => task.schedule === 'overdue');
  const soon = tasks.filter((task) => task.schedule === 'due_soon');
  const risk = tasks.filter((task) => task.schedule === 'at_risk');
  const rest = tasks.filter((task) => !['overdue', 'due_soon', 'at_risk'].includes(task.schedule));
  const meetings = data?.meetings || [];
  const today = localDateKey();
  const weekEndDate = addLocalDays(7);
  const thisWeek = meetings.filter((meeting) => meeting.dates.some((date) => date >= today && date <= weekEndDate));

  return (
    <>
      <PageTitle>Your desk</PageTitle>
      <div className="page-head">
        <div className="page-title">
          <h1>Your desk</h1>
          <p className="muted">Everything waiting for you, across every project.</p>
        </div>
      </div>

      <div className="home-stats">
        <Stat label="Late" value={late.length} tone={late.length ? 'danger' : 'muted'} />
        <Stat label="Due this week" value={soon.length} tone={soon.length ? 'warn' : 'muted'} />
        <Stat label="Behind schedule" value={risk.length} tone={risk.length ? 'warn' : 'muted'} />
        <Stat label="Meetings this week" value={thisWeek.length} tone="muted" />
      </div>

      <div className="split home-split">
        <section>
          <h2>Your tasks</h2>
          {tasks.length === 0 ? (
            <Empty title="Nothing is assigned to you" mood="happy">
              When the studio gives you a task, it shows up here.
            </Empty>
          ) : (
            <div className="list">
              {[...late, ...soon, ...risk, ...rest].map((task) => (
                <Link
                  className={`row-item home-task ${task.schedule === 'overdue' ? 'late' : ''}`}
                  key={task.id}
                  to={`/projects/${task.project_id}?tab=tasks&task=${task.id}`}
                >
                  <div>
                    <strong>{task.title}</strong>
                    <small className="muted block">
                      {task.project_name} · {dueLabel(task) || 'no date'}
                    </small>
                  </div>
                  <span className={`chip chip-${scheduleState(task)}`}>{task.progress}%</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2>This week</h2>
          {thisWeek.length === 0 ? (
            <Empty title="No meetings this week" mood="normal">
              Meetings from every project land here when they are planned.
            </Empty>
          ) : (
            <div className="list">
              {thisWeek.map((meeting) => (
                <Link className="row-item" key={meeting.id} to="/meetings">
                  <div>
                    <strong>{meeting.title}</strong>
                    <small className="muted block">
                      {meeting.project_name} · {meeting.dates.filter((date) => date >= today)[0]} · {meeting.start_time?.slice(0, 5)}
                    </small>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <h2 className="mt">Your projects</h2>
          {(data?.projects || []).length === 0 ? (
            <p className="muted">You are not in a project yet.</p>
          ) : (
            <div className="list">
              {(data?.projects || []).map((project) => (
                <Link className="row-item" key={project.id} to={`/projects/${project.id}`}>
                  <div>
                    <strong>{project.name}</strong>
                    <Progress value={project.progress} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`home-stat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
