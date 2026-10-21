// Scheduling health: how a task is doing against its dates, and what needs
// attention right now.
//
// Every task carries a schedule state so the list, the attention view and the
// portfolio all speak the same language:
//
//   done        finished
//   overdue     the end date has passed and the work is not finished
//   due_soon    due within a week
//   at_risk     the progress is behind the time that has already gone
//   on_track    dated and keeping up
//   no_date     nothing is scheduled
const DAY = 86400000;
const DUE_SOON_DAYS = 7;
const STALE_DAYS = 7;
const AT_RISK_MARGIN = 0.15;

function startOfDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Dates arrive as strings from SQLite and as Date objects from MySQL, so
// both shapes have to be understood.
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const date = new Date(value.getTime());
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// A plain YYYY-MM-DD string, whatever the driver handed over.
function isoDate(value) {
  const date = parseDate(value);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// "in 12 days", "3 days late", "today", "2 weeks ago"
function relativeDay(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) return null;
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) {
    if (days < 14) return `in ${days} days`;
    if (days < 60) return `in ${Math.round(days / 7)} weeks`;
    return `in ${Math.round(days / 30)} months`;
  }
  const late = Math.abs(days);
  if (late < 14) return `${late} days late`;
  if (late < 60) return `${Math.round(late / 7)} weeks late`;
  return `${Math.round(late / 30)} months late`;
}

// The schedule state of a single task.
function computeSchedule(task, now = new Date()) {
  const progress = Number(task.progress) || 0;
  const start = parseDate(task.start_date);
  const end = parseDate(task.end_date);
  const today = startOfDay(now);

  if (progress >= 100) {
    return { state: 'done', daysLeft: end ? Math.round((startOfDay(end) - today) / DAY) : null, severity: 0 };
  }
  if (!start && !end) {
    return { state: 'no_date', daysLeft: null, severity: 0 };
  }

  const daysLeft = end ? Math.round((startOfDay(end) - today) / DAY) : null;
  if (daysLeft !== null && daysLeft < 0) {
    return { state: 'overdue', daysLeft, severity: 3 };
  }
  // Work that has not started yet is not "on track", it is simply not started.
  if (progress === 0 && start && startOfDay(start) > today) {
    return { state: 'not_started', daysLeft, severity: 0 };
  }
  if (daysLeft !== null && daysLeft <= DUE_SOON_DAYS) {
    return { state: 'due_soon', daysLeft, severity: 2 };
  }

  // Behind schedule: less done than the calendar says we should be.
  if (start && end) {
    const total = (startOfDay(end) - startOfDay(start)) / DAY;
    const elapsed = (today - startOfDay(start)) / DAY;
    if (total > 0 && elapsed > 0) {
      const expected = Math.min(1, elapsed / total);
      if (progress / 100 < expected - AT_RISK_MARGIN) {
        return { state: 'at_risk', daysLeft, severity: 2 };
      }
    }
  }
  return { state: 'on_track', daysLeft, severity: 0 };
}

// Work that needs a person, grouped by why it needs them.
function attentionFor(tasks, options = {}) {
  const now = options.now || new Date();
  const userId = options.userId ? Number(options.userId) : null;
  // Only a person who can only see their own work gets a personal list.
  const onlyMine = options.onlyMine === true;
  const buckets = {
    overdue: [],
    due_soon: [],
    unassigned: [],
    stale: [],
    blocked: []
  };

  const byId = new Map(tasks.map(task => [task.id, task]));
  const doneIds = new Set(
    tasks.filter(task => (Number(task.progress) || 0) >= 100).map(task => task.id)
  );

  for (const task of tasks) {
    const schedule = computeSchedule(task, now);
    const assigned = (task.assignees || []).some(a => Number(a.id) === userId);
    const mine = onlyMine ? assigned : true;
    const updatedAt = task.updated_at ? new Date(task.updated_at) : null;
    const staleDays = updatedAt ? (now - updatedAt) / DAY : 0;
    const blocked = (task.depends_on || []).some(id => !doneIds.has(id));

    if (mine) {
      if (schedule.state === 'overdue') buckets.overdue.push(task);
      else if (schedule.state === 'due_soon') buckets.due_soon.push(task);
      if (!onlyMine && !(task.assignees || []).length && schedule.state !== 'done') {
        buckets.unassigned.push(task);
      }
      if (staleDays >= STALE_DAYS && schedule.state !== 'done' && (Number(task.progress) || 0) > 0) {
        buckets.stale.push(task);
      }
      if (blocked && schedule.state !== 'done') buckets.blocked.push(task);
    }
  }

  const order = (a, b) => {
    const aSchedule = computeSchedule(a, now);
    const bSchedule = computeSchedule(b, now);
    if (aSchedule.severity !== bSchedule.severity) return bSchedule.severity - aSchedule.severity;
    return (aSchedule.daysLeft ?? 9999) - (bSchedule.daysLeft ?? 9999);
  };
  for (const key of Object.keys(buckets)) buckets[key].sort(order);
  return buckets;
}

// A short summary of a project's health, used by the portfolio view.
function projectSummary(project, tasks, options = {}) {
  const now = options.now || new Date();
  const schedules = tasks.map(task => computeSchedule(task, now));
  const overdue = schedules.filter(schedule => schedule.state === 'overdue').length;
  const dueSoon = schedules.filter(schedule => schedule.state === 'due_soon').length;
  const atRisk = schedules.filter(schedule => schedule.state === 'at_risk').length;
  const finished = tasks.filter(task => (Number(task.progress) || 0) >= 100).length;

  const dated = tasks
    .filter(task => task.end_date && (Number(task.progress) || 0) < 100)
    .sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
  const next = dated[0] || null;

  return {
    total: tasks.length,
    finished,
    overdue,
    dueSoon,
    atRisk,
    attention: overdue + dueSoon + atRisk,
    nextDeadline: next ? { id: next.id, title: next.title, end_date: next.end_date } : null
  };
}

module.exports = {
  DAY,
  DUE_SOON_DAYS,
  STALE_DAYS,
  computeSchedule,
  relativeDay,
  attentionFor,
  projectSummary,
  parseDate,
  isoDate,
  startOfDay
};
