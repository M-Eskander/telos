const knex = require('../config/knex');

const DAY = 86400000;
const RECURRENCES = ['once', 'daily', 'weekly', 'monthly'];

const dateOnly = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};
// Dates arrive as strings from SQLite and as Date objects from MySQL.
const dayNumber = (value) => {
  if (value instanceof Date) return Math.round(value.getTime() / DAY);
  return Math.round(Date.parse(`${dateOnly(value)}T00:00:00.000Z`) / DAY);
};
const fromDay = (day) => new Date(day * DAY).toISOString().slice(0, 10);
const weekdayList = (value) => {
  if (Array.isArray(value)) return value.map(Number).filter((day) => day >= 0 && day <= 6);
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(Number).filter((day) => day >= 0 && day <= 6);
    } catch { /* not a list */ }
  }
  return [];
};

// Every date the meeting happens on, between two days.
function occurrences(meeting, from, to) {
  const start = dayNumber(meeting.start_date);
  const until = meeting.until_date ? dayNumber(meeting.until_date) : null;
  const last = dayNumber(to);
  const first = Math.max(start, dayNumber(from));
  const limit = until ? Math.min(last, until) : last;
  if (limit < first) return [];

  const interval = Math.max(1, Number(meeting.recurrence_interval) || 1);
  const dates = [];
  // A meeting that repeats forever still only shows the next few weeks.
  const MAX_DATES = 120;
  const push = (day) => {
    if (dates.length >= MAX_DATES) return;
    if (day >= first && day <= limit) dates.push(fromDay(day));
  };

  if (meeting.recurrence === 'once') {
    push(start);
    return dates;
  }
  if (meeting.recurrence === 'daily') {
    for (let day = start; day <= limit; day += interval) push(day);
    return dates;
  }
  if (meeting.recurrence === 'weekly') {
    const weekdays = weekdayList(meeting.weekdays).length
      ? weekdayList(meeting.weekdays)
      : [new Date(start * DAY).getUTCDay()];
    for (let day = start; day <= limit; day += 1) {
      const weekday = new Date(day * DAY).getUTCDay();
      if (!weekdays.includes(weekday)) continue;
      const weeks = Math.floor((day - start) / (7 * interval));
      const weekStart = start + weeks * 7 * interval;
      if (day - weekStart < 7) push(day);
    }
    return dates;
  }
  if (meeting.recurrence === 'monthly') {
    const dayOfMonth = meeting.monthly_day || new Date(start * DAY).getUTCDate();
    const cursor = new Date(start * DAY);
    for (let index = 0; index < 400; index += 1) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + index * interval;
      const candidate = Date.UTC(year, month, dayOfMonth);
      if (candidate > limit * DAY) break;
      if (candidate >= start * DAY) push(Math.round(candidate / DAY));
    }
    return dates;
  }
  push(start);
  return dates;
}

function publicMeeting(row, dates) {
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name || null,
    title: row.title,
    notes: row.notes,
    start_date: row.start_date,
    start_time: row.start_time,
    duration_minutes: row.duration_minutes,
    recurrence: row.recurrence,
    recurrence_interval: row.recurrence_interval,
    weekdays: weekdayList(row.weekdays),
    monthly_day: row.monthly_day,
    until_date: row.until_date,
    attendees: row.attendees || [],
    created_by: row.created_by,
    dates
  };
}

async function attachAttendees(rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map((row) => row.id);
  const attendance = await knex('project_meeting_attendees')
    .whereIn('meeting_id', ids)
    .select('meeting_id', 'user_id');
  const people = await knex('users').select('id', 'name');
  const byMeeting = new Map();
  for (const entry of attendance) {
    const person = people.find((candidate) => candidate.id === entry.user_id);
    if (!person) continue;
    if (!byMeeting.has(entry.meeting_id)) byMeeting.set(entry.meeting_id, []);
    byMeeting.get(entry.meeting_id).push({ id: person.id, name: person.name });
  }
  for (const row of rows) row.attendees = byMeeting.get(row.id) || [];
  return rows;
}

async function listProjectMeetings(projectId) {
  const rows = await knex('project_meetings as m')
    .leftJoin('projects as p', 'p.id', 'm.project_id')
    .where('m.project_id', projectId)
    .select('m.*', 'p.name as project_name')
    .orderBy('m.start_date', 'asc');
  await attachAttendees(rows);
  const horizon = fromDay(dayNumber(new Date()) + 400);
  return rows.map((row) => publicMeeting(row, occurrences(row, row.start_date, horizon)));
}

async function createMeeting(projectId, payload, actorId) {
  const title = String(payload.title || '').trim();
  if (!title) throw new TypeError('The meeting needs a name');
  const recurrence = RECURRENCES.includes(payload.recurrence) ? payload.recurrence : 'once';
  const startDate = dateOnly(payload.start_date || new Date().toISOString());
  const weekdays = Array.isArray(payload.weekdays)
    ? payload.weekdays.map(Number).filter((day) => day >= 0 && day <= 6)
    : [];
  const [id] = await knex('project_meetings').insert({
    project_id: projectId,
    title: title.slice(0, 160),
    notes: payload.notes ? String(payload.notes).slice(0, 4000) : null,
    start_date: startDate,
    start_time: String(payload.start_time || '10:00:00').slice(0, 8),
    duration_minutes: Math.max(5, Math.min(1440, Number(payload.duration_minutes) || 60)),
    recurrence,
    recurrence_interval: Math.max(1, Math.min(12, Number(payload.recurrence_interval) || 1)),
    weekdays: weekdays.length ? JSON.stringify(weekdays) : null,
    monthly_day: recurrence === 'monthly' ? (Number(payload.monthly_day) || null) : null,
    until_date: payload.until_date ? dateOnly(payload.until_date) : null,
    created_by: actorId,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });
  await setAttendees(projectId, id, payload.attendee_ids);
  return listProjectMeetings(projectId).then((all) => all.find((row) => row.id === id) || null);
}

async function setAttendees(projectId, meetingId, attendeeIds) {
  const existing = await knex('project_meeting_attendees').where({ meeting_id: meetingId }).del();
  if (!Array.isArray(attendeeIds) || attendeeIds.length === 0) return existing;
  const members = await knex('project_memberships').where({ project_id: projectId }).select('user_id');
  const allowed = new Set(members.map((member) => member.user_id));
  const chosen = [...new Set(attendeeIds.map(Number))].filter((id) => allowed.has(id));
  if (chosen.length) {
    await knex('project_meeting_attendees').insert(chosen.map((userId) => ({
      meeting_id: meetingId,
      user_id: userId,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    })));
  }
  return existing;
}

async function updateMeeting(projectId, meetingId, payload) {
  const meeting = await knex('project_meetings').where({ id: meetingId, project_id: projectId }).first();
  if (!meeting) return null;
  const payloadRow = { updated_at: knex.fn.now() };
  if (payload.title !== undefined) payloadRow.title = String(payload.title).trim().slice(0, 160) || meeting.title;
  if (payload.notes !== undefined) payloadRow.notes = String(payload.notes).slice(0, 4000);
  if (payload.start_date !== undefined) payloadRow.start_date = dateOnly(payload.start_date);
  if (payload.start_time !== undefined) payloadRow.start_time = String(payload.start_time).slice(0, 8);
  if (payload.duration_minutes !== undefined) {
    payloadRow.duration_minutes = Math.max(5, Math.min(1440, Number(payload.duration_minutes) || 60));
  }
  if (payload.recurrence !== undefined && RECURRENCES.includes(payload.recurrence)) {
    payloadRow.recurrence = payload.recurrence;
  }
  if (payload.recurrence_interval !== undefined) {
    payloadRow.recurrence_interval = Math.max(1, Math.min(12, Number(payload.recurrence_interval) || 1));
  }
  if (payload.weekdays !== undefined) {
    const weekdays = Array.isArray(payload.weekdays)
      ? payload.weekdays.map(Number).filter((day) => day >= 0 && day <= 6)
      : [];
    payloadRow.weekdays = weekdays.length ? JSON.stringify(weekdays) : null;
  }
  if (payload.monthly_day !== undefined) {
    payloadRow.monthly_day = payload.monthly_day ? Number(payload.monthly_day) : null;
  }
  if (payload.until_date !== undefined) {
    payloadRow.until_date = payload.until_date ? dateOnly(payload.until_date) : null;
  }
  await knex('project_meetings').where({ id: meetingId }).update(payloadRow);
  if (payload.attendee_ids !== undefined) await setAttendees(projectId, meetingId, payload.attendee_ids);
  return listProjectMeetings(projectId).then((all) => (
    all.find((row) => Number(row.id) === Number(meetingId)) || null
  ));
}

async function deleteMeeting(projectId, meetingId) {
  const removed = await knex('project_meetings').where({ id: meetingId, project_id: projectId }).del();
  return removed > 0;
}

// The meetings of one person, across every project they are in.
async function listMeetingsForUser(userId, { from, to } = {}) {
  const start = from || new Date().toISOString().slice(0, 10);
  const end = to || new Date(Date.now() + 120 * DAY).toISOString().slice(0, 10);
  const rows = await knex('project_meetings as m')
    .leftJoin('projects as p', 'p.id', 'm.project_id')
    .leftJoin('project_meeting_attendees as a', 'a.meeting_id', 'm.id')
    .where((builder) => {
      builder.where('a.user_id', userId).orWhere('m.created_by', userId);
    })
    .distinct('m.id')
    .select('m.*', 'p.name as project_name')
    .orderBy('m.start_date', 'asc');
  await attachAttendees(rows);
  return rows
    .map((row) => publicMeeting(row, occurrences(row, start, end)))
    .filter((row) => row.dates.length > 0);
}

// Every meeting of every project the person can see, for the planning page.
async function listAllMeetings({ from, to } = {}) {
  const start = from || new Date().toISOString().slice(0, 10);
  const end = to || new Date(Date.now() + 120 * DAY).toISOString().slice(0, 10);
  const rows = await knex('project_meetings as m')
    .leftJoin('projects as p', 'p.id', 'm.project_id')
    .select('m.*', 'p.name as project_name')
    .orderBy('m.start_date', 'asc');
  await attachAttendees(rows);
  return rows
    .map((row) => publicMeeting(row, occurrences(row, start, end)))
    .filter((row) => row.dates.length > 0);
}

module.exports = {
  RECURRENCES,
  occurrences,
  listProjectMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  listMeetingsForUser,
  listAllMeetings
};
