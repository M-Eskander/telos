// Reusable project access levels. These are intentionally stored as ordinary
// attributes so the existing RBAC/ABAC permission engine can enforce them.
const ACCESS_PRESETS = Object.freeze({
  project_admin: {
    key: 'project_admin',
    attribute: 'project_admin',
    label: 'Owner-like',
    description: 'Manage this project, its team, and every task. Cannot delete the project.',
    attributeDescription: 'Can manage this project, its team, and all tasks (but not delete the project).'
  },
  project_manager: {
    key: 'project_manager',
    attribute: 'project_manager',
    label: 'Project manager',
    description: 'Manage every task and the project team. Cannot change project settings or delete the project.',
    attributeDescription: 'Can create, edit, assign, and delete tasks and manage the project team.'
  },
  project_member: {
    key: 'project_member',
    attribute: 'project_member',
    label: 'Team member',
    description: 'Read everything in this project. Update progress only on tasks assigned to them.',
    attributeDescription: 'Can read this project and update progress on assigned tasks.'
  },
  project_limited: {
    key: 'project_limited',
    attribute: 'project_limited',
    label: 'Low-access member',
    description: 'See only assigned tasks. Update progress only on those tasks.',
    attributeDescription: 'Can see and update progress only on tasks assigned to them.'
  }
});

const PRESET_KEYS = Object.freeze(Object.keys(ACCESS_PRESETS));
const PRESET_ATTRIBUTE_NAMES = Object.freeze(
  Object.values(ACCESS_PRESETS).map(preset => preset.attribute)
);

function getPreset(key) {
  return key && Object.prototype.hasOwnProperty.call(ACCESS_PRESETS, key)
    ? ACCESS_PRESETS[key]
    : null;
}

function presetByAttribute(name) {
  return Object.values(ACCESS_PRESETS).find(preset => preset.attribute === name) || null;
}

module.exports = {
  ACCESS_PRESETS,
  PRESET_KEYS,
  PRESET_ATTRIBUTE_NAMES,
  getPreset,
  presetByAttribute
};
