import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, ErrorNote, Loading, PageTitle, useAsync } from '../ui.jsx';
import { addLocalDays, localDateKey } from '../date-utils.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RECURRENCE_LABEL = {
  once: 'One time',
  daily: 'Every day',
  weekly: 'Weekly',
  monthly: 'Monthly'
};

// Every meeting of every project, and the ones this person is part of.
export default function Meetings() {
  const state = useAsync(() => api('/me/meetings'), []);
  const [showAll, setShowAll] = useState(false);
  if (state.loading && !state.data) return <Loading label="Gathering the meetings…" />;
  if (state.error) return <ErrorNote error={state.error} retry={state.reload} />;

  const mine = state.data?.meetings || [];
  const all = state.data?.all || [];
  const today = localDateKey();
  const weekEnd = addLocalDays(7);

  const week = mine.filter((meeting) => meeting.dates.some((date) => date >= today && date <= weekEnd));
  const coming = mine.filter((meeting) => !week.includes(meeting));
  const other = all.filter((meeting) => !mine.some((entry) => entry.id === meeting.id));

  return (
    <>
      <PageTitle>Meetings</PageTitle>
      <div className="page-head">
        <div className="page-title">
          <h1>Meetings</h1>
          <p className="muted">The studio's calendar: what is planned, when, and who is in it.</p>
        </div>
      </div>

      <div className={`split home-split ${other.length ? '' : 'meetings-single'}`}>
        <section>
          <h2>This week</h2>
          {week.length === 0 ? (
            <Empty title="Nothing planned this week" mood="normal">
              A meeting created inside a project lands here for everyone it invites.
            </Empty>
          ) : (
            <div className="list">{week.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} today={today} />)}</div>
          )}

          <h2 className="mt">Coming up</h2>
          {coming.length === 0 ? (
            <p className="muted">Nothing else on your calendar.</p>
          ) : (
            <div className="list">{coming.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} today={today} />)}</div>
          )}
        </section>

        {other.length > 0 && (
          <section>
            <div className="section-head">
              <h2>Other meetings</h2>
              <button className="link" onClick={() => setShowAll((value) => !value)}>
                {showAll ? 'Hide the rest' : `Show all (${other.length})`}
              </button>
            </div>
            {showAll ? (
              <div className="list">{other.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} today={today} />)}</div>
            ) : (
              <p className="muted">Meetings you are not part of are hidden until you show them.</p>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function MeetingRow({ meeting, today }) {
  const next = meeting.dates.find((date) => date >= today) || meeting.dates[0];
  const day = next ? new Date(`${next}T00:00:00`) : null;
  return (
    <div className="row-item meeting-row">
      <div className="meeting-when">
        <strong>{day ? day.getDate() : '—'}</strong>
        <small className="muted block">{day ? day.toLocaleDateString(undefined, { month: 'short' }) : ''}</small>
      </div>
      <div>
        <strong>{meeting.title}</strong>
        <small className="muted block">
          {meeting.project_name} · {meeting.start_time?.slice(0, 5)} · {meeting.duration_minutes} min ·{' '}
          {RECURRENCE_LABEL[meeting.recurrence] || meeting.recurrence}
        </small>
        {meeting.attendees.length > 0 && (
          <small className="muted block">With {meeting.attendees.map((person) => person.name).join(', ')}</small>
        )}
      </div>
      <Link className="link" to={`/projects/${meeting.project_id}?tab=meetings`}>Open</Link>
    </div>
  );
}
