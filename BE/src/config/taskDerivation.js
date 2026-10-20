// Task derivation rules.
//
// Weight and progress are the only user-controlled values on a task. Priority
// and status are always derived so the model can never contradict itself:
//
//   weight  -> priority   (three weight steps per level, on a 0-12 scale)
//   progress -> status     (0 = to do, 1-99 = in progress, 100 = done)
//
// A task with children is never edited directly: its weight, progress,
// priority and status are calculated from its subtasks.
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 12;

// Each priority covers three weight steps. The first band starts at 0.
const PRIORITY_BANDS = Object.freeze([
  Object.freeze({ priority: 'low', min: 0, max: 3 }),
  Object.freeze({ priority: 'medium', min: 3, max: 6 }),
  Object.freeze({ priority: 'high', min: 6, max: 9 }),
  Object.freeze({ priority: 'critical', min: 9, max: 12 })
]);

const PRIORITIES = Object.freeze(PRIORITY_BANDS.map(band => band.priority));
const STATUSES = Object.freeze(['todo', 'in_progress', 'done']);

function priorityForWeight(weight) {
  const value = Number(weight);
  if (!Number.isFinite(value)) return 'low';
  for (const band of PRIORITY_BANDS) {
    if (value <= band.max) return band.priority;
  }
  return PRIORITY_BANDS[PRIORITY_BANDS.length - 1].priority;
}

function statusForProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value) || value <= 0) return 'todo';
  if (value >= 100) return 'done';
  return 'in_progress';
}

function isValidWeight(weight) {
  const value = Number(weight);
  return Number.isFinite(value) && value >= WEIGHT_MIN && value <= WEIGHT_MAX;
}

module.exports = {
  WEIGHT_MIN,
  WEIGHT_MAX,
  PRIORITY_BANDS,
  PRIORITIES,
  STATUSES,
  priorityForWeight,
  statusForProgress,
  isValidWeight
};
