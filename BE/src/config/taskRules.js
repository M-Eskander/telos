// The task derivation rules, published so every client reads them from the
// server instead of keeping its own copy. The browser uses these to preview
// the priority a weight produces and the status a progress value produces,
// while the server remains the only place the rules are defined.
const {
  WEIGHT_MIN,
  WEIGHT_MAX,
  PRIORITY_BANDS,
  PRIORITIES,
  STATUSES
} = require('./taskDerivation');
const { ACCESS_PRESETS } = require('./accessPresets');

// Bumped whenever the rules change, so a client can tell a cached copy is
// out of date.
const RULES_VERSION = '1';

const WEIGHT_STEP = 0.5;

function taskRules() {
  return {
    version: RULES_VERSION,
    weight: {
      min: WEIGHT_MIN,
      max: WEIGHT_MAX,
      step: WEIGHT_STEP
    },
    bands: PRIORITY_BANDS.map(band => ({
      priority: band.priority,
      min: band.min,
      max: band.max
    })),
    priorities: [...PRIORITIES],
    statuses: [...STATUSES],
    status: {
      // Progress at or below 0 is "to do", 100 is "done", anything between is
      // "in progress".
      todo: { max: 0 },
      in_progress: { min: 1, max: 99 },
      done: { min: 100 }
    }
  };
}

// The access levels a role can be created with, published for the same
// reason: the labels and descriptions live on the server only.
function accessPresets() {
  return {
    version: RULES_VERSION,
    presets: Object.values(ACCESS_PRESETS).map((preset) => ({
      key: preset.key,
      attribute: preset.attribute,
      label: preset.label,
      description: preset.description
    }))
  };
}

module.exports = { taskRules, accessPresets, RULES_VERSION, WEIGHT_STEP };