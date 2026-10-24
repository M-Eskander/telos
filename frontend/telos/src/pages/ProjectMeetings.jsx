import { useState } from 'react';
import { api, list } from '../api.js';
import { ask, Empty, ErrorNote, Field, Loading, Modal, fmtDate, notify, useAsync, useSubmit } from '../ui.jsx';
import { localDateKey } from '../date-utils.js';

const RECURRENCE_LABEL = {
  once: 'One time',
  daily: 'Every day',
  weekly: 'Weekly',
  monthly: 'Monthly'
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayOf = (date) => {
  const day = new Date(`${String(date).slice(0, 10)}T00:00:00`).getDay();
  return Number.isInteger(day) ? day : 1;
};

// The meetings of one project, and the form that plans them.
export default function ProjectMeetings({ projectId, members, canManage = false }) {
  const state = useAsync(() => api(`/projects/${projectId}/meetings`), [projectId]);
  const people = list(members.data, 'members');
  // `form` is either null (closed) or { meeting } where meeting is null for a new one.
  const [form, setForm] = useState(null);

  if (state.loading && !state.data) return <Loading label="Opening the meetings…" />;
  if (state.error) return <ErrorNote error={state.error} retry={state.reload} />;

  const meetings = state.data?.meetings || [];

  return (
    <div>
      <div className="page-head section-head">
        <h2>Meetings</h2>
        {canManage && <button className="primary" onClick={() => setForm({ meeting: null })}>Plan a meeting</button>}
      </div>
      <p className="muted">
        A meeting planned here shows on the meetings page of everyone it invites.
      </p>

      {meetings.length === 0 ? (
        <Empty title="Nothing planned yet" mood="happy">
          {canManage ? 'Plan the first one.' : 'The studio has not planned any meeting for this project yet.'}
        </Empty>
      ) : (
        <div className="list">
          {meetings.map((meeting) => (
            <MeetingItem
              key={meeting.id}
              meeting={meeting}
              projectId={projectId}
              canManage={canManage}
              onEdit={() => setForm({ meeting })}
              onChanged={() => state.reload()}
            />
          ))}
        </div>
      )}

      {form && (
        <MeetingForm
          projectId={projectId}
          people={people}
          meeting={form.meeting}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); state.reload(); }}
        />
      )}
    </div>
  );
}

function MeetingItem({ meeting, projectId, canManage, onEdit, onChanged }) {
  const remove = useSubmit();
  const next = meeting.dates[0];
  return (
    <div className="row-item">
      <div>
        <strong>{meeting.title}</strong>
        <small className="muted block">
          {next ? `${fmtDate(next)} · ` : ''}{meeting.start_time?.slice(0, 5)} · {meeting.duration_minutes} min ·{' '}
          {RECURRENCE_LABEL[meeting.recurrence] || meeting.recurrence}
        </small>
        {meeting.attendees.length > 0 && (
          <small className="muted block">With {meeting.attendees.map((person) => person.name).join(', ')}</small>
        )}
        {meeting.notes && <small className="muted block meeting-notes">{meeting.notes}</small>}
      </div>
      {canManage && (
        <div className="row">
          <button className="link" onClick={onEdit}>Edit</button>
          <button
            className="link danger-text"
            disabled={remove.busy}
            onClick={async () => {
              if (!(await ask(`Remove the meeting "${meeting.title}"?`, 'Remove'))) return;
              await remove.submit(async () => {
                await api(`/projects/${projectId}/meetings/${meeting.id}`, { method: 'DELETE' });
                notify('Meeting removed');
                onChanged();
              });
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function MeetingForm({ projectId, people, meeting = null, onClose, onSaved }) {
  const editing = Boolean(meeting);
  const startDate = meeting ? String(meeting.start_date).slice(0, 10) : localDateKey();
  const savedWeekdays = Array.isArray(meeting?.weekdays) ? meeting.weekdays : [];
  const initialWeekdays = savedWeekdays.length
    ? savedWeekdays
    : meeting?.recurrence === 'weekly'
      ? [dayOf(startDate)]
      : [1];
  const [f, setF] = useState({
    title: meeting?.title || '',
    notes: meeting?.notes || '',
    start_date: startDate,
    start_time: meeting?.start_time ? String(meeting.start_time).slice(0, 5) : '10:00',
    duration_minutes: meeting?.duration_minutes ?? 60,
    recurrence: meeting?.recurrence || 'weekly',
    recurrence_interval: meeting?.recurrence_interval ?? 1,
    weekdays: initialWeekdays,
    monthly_day: meeting?.monthly_day ?? null,
    until_date: meeting?.until_date ? String(meeting.until_date).slice(0, 10) : '',
    attendee_ids: (meeting?.attendees || []).map((person) => person.id)
  });
  const { busy, error, submit } = useSubmit();
  const set = (key) => (event) => setF({ ...f, [key]: event.target.value });

  const toggleWeekday = (day) => setF({
    ...f,
    weekdays: f.weekdays.includes(day) ? f.weekdays.filter((value) => value !== day) : [...f.weekdays, day]
  });

  const togglePerson = (id) => setF({
    ...f,
    attendee_ids: f.attendee_ids.includes(id)
      ? f.attendee_ids.filter((value) => value !== id)
      : [...f.attendee_ids, id]
  });

  const save = (event) => {
    event.preventDefault();
    submit(async () => {
      await api(`/projects/${projectId}/meetings${editing ? `/${meeting.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: {
          ...f,
          duration_minutes: Number(f.duration_minutes),
          recurrence_interval: Number(f.recurrence_interval),
          weekdays: f.recurrence === 'weekly' ? f.weekdays : [],
          monthly_day: f.recurrence === 'monthly' ? Number(f.monthly_day || 1) : null,
          until_date: f.until_date || null
        }
      });
      notify(editing ? 'Meeting updated' : 'Meeting planned');
      onSaved();
    });
  };

  return (
    <Modal title={editing ? 'Edit meeting' : 'Plan a meeting'} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="two">
          <Field label="Name"><input autoFocus required value={f.title} onChange={set('title')} placeholder="Studio sync" /></Field>
          <Field label="First date"><input type="date" required value={f.start_date} onChange={set('start_date')} /></Field>
          <Field label="Time"><input type="time" required value={f.start_time} onChange={set('start_time')} /></Field>
          <Field label="Length in minutes">
            <input type="number" min="5" step="5" value={f.duration_minutes} onChange={set('duration_minutes')} />
          </Field>
        </div>

        <Field label="How often">
          <select value={f.recurrence} onChange={set('recurrence')}>
            {Object.entries(RECURRENCE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>

        {f.recurrence === 'weekly' && (
          <Field label="Days">
            <div className="weekday-row">
              {WEEKDAYS.map((label, day) => (
                <button
                  type="button"
                  key={day}
                  className={`weekday ${f.weekdays.includes(day) ? 'on' : ''}`}
                  onClick={() => toggleWeekday(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        )}

        {f.recurrence === 'monthly' && (
          <Field label="Day of the month">
            <input type="number" min="1" max="31" value={f.monthly_day || ''} onChange={set('monthly_day')} />
          </Field>
        )}

        {f.recurrence !== 'once' && (
          <div className="two">
            <Field label="Repeat every">
              <input type="number" min="1" max="12" value={f.recurrence_interval} onChange={set('recurrence_interval')} />
            </Field>
            <Field label="Until (optional)"><input type="date" value={f.until_date} onChange={set('until_date')} /></Field>
          </div>
        )}

        <Field label="Who comes" hint="Everyone picked sees this on their meetings page.">
          <div className="attendee-grid">
            {people.length === 0 && <p className="muted">This project has no members yet.</p>}
            {people.map((person) => (
              <label className="attendee" key={person.userId}>
                <input
                  type="checkbox"
                  checked={f.attendee_ids.includes(person.userId)}
                  onChange={() => togglePerson(person.userId)}
                />
                <span>{person.name}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Notes (optional)"><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>

        <ErrorNote error={error} />
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Plan it'}</button>
        </footer>
      </form>
    </Modal>
  );
}
