// How a task is doing against its dates. The state comes from the server
// (see BE/src/services/schedule.service.js); this file only says how each
// state looks.
export const SCHEDULE = {
  overdue: { label: 'Overdue', kind: 'danger' },
  due_soon: { label: 'Due soon', kind: 'warn' },
  at_risk: { label: 'At risk', kind: 'progress' },
  on_track: { label: 'On track', kind: 'ok' },
  not_started: { label: 'Not started', kind: 'muted' },
  done: { label: 'Done', kind: 'done' },
  no_date: { label: 'No date', kind: 'muted' }
};

// Only the states worth interrupting someone about.
export const NOTABLE = ['overdue', 'due_soon', 'at_risk'];

export function scheduleState(task) {
  return (task && task.schedule && task.schedule.state) || 'no_date';
}

export function scheduleMeta(task) {
  return SCHEDULE[scheduleState(task)] || SCHEDULE.no_date;
}

export function isNotable(task) {
  return NOTABLE.includes(scheduleState(task));
}

// "3 days late" with the real date kept for the tooltip.
export function dueLabel(task) {
  if (task.due && task.due.relative) return task.due.relative;
  return null;
}

export function dueTitle(task) {
  return task.end_date ? `Ends ${task.end_date}` : '';
}
