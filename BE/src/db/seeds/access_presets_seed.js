// Idempotently installs the built-in project access presets.
//
// This is intentionally additive: it creates missing attributes, permissions,
// and grant options, but never deletes existing role assignments or grant
// rules. That makes it safe to run against a database that already has custom
// access configuration.
const { ACCESS_PRESETS } = require('../../config/accessPresets');

const PERMISSION_CATALOG = [
  { action: 'create', resource: 'project', description: 'Create projects' },
  { action: 'read', resource: 'project', description: 'View projects' },
  { action: 'update', resource: 'project', description: 'Edit project settings' },
  { action: 'manage_team', resource: 'project', description: 'Add, remove, and organize a project team' },
  { action: 'delete', resource: 'project', description: 'Delete projects' },
  { action: 'read', resource: 'team', description: 'View a project team' },
  { action: 'create', resource: 'task', description: 'Create tasks' },
  { action: 'read', resource: 'task', description: 'View tasks' },
  { action: 'view_own', resource: 'task', description: 'Only view tasks assigned to the current person' },
  { action: 'update', resource: 'task', description: 'Update tasks (assigned members are limited to progress)' },
  { action: 'delete', resource: 'task', description: 'Delete tasks' },
  { action: 'manage', resource: 'task', description: 'Edit every field on a task' },
  { action: 'assign', resource: 'task', description: 'Assign people to tasks' }
];

// Each entry is an OR option. Within an option the attributes are ANDed.
const PERMISSION_GRANTS = {
  'read:project': [
    ['project_admin'],
    ['project_manager'],
    ['project_member'],
    ['project_limited']
  ],
  'update:project': [['project_admin']],
  'manage_team:project': [['project_admin'], ['project_manager']],
  'delete:project': [],
  'create:project': [],
  'read:team': [
    ['project_admin'],
    ['project_manager'],
    ['project_member']
  ],
  'read:task': [
    ['project_admin'],
    ['project_manager'],
    ['project_member'],
    ['project_limited']
  ],
  'view_own:task': [['project_limited']],
  'update:task': [
    ['project_admin'],
    ['project_manager'],
    ['project_member'],
    ['project_limited']
  ],
  'create:task': [['project_admin'], ['project_manager']],
  'delete:task': [['project_admin'], ['project_manager']],
  'manage:task': [['project_admin'], ['project_manager']],
  'assign:task': [['project_admin'], ['project_manager']]
};

async function ensureAttribute(knex, preset) {
  let attribute = await knex('attributes').where({ name: preset.attribute }).first();
  if (!attribute) {
    const [id] = await knex('attributes').insert({
      name: preset.attribute,
      resource: 'project',
      description: preset.attributeDescription
    });
    attribute = await knex('attributes').where({ id }).first();
  } else if (attribute.resource !== 'project') {
    throw new Error(`Attribute ${preset.attribute} already exists with resource ${attribute.resource}`);
  }
  return attribute;
}

async function ensurePermission(knex, permission) {
  let row = await knex('permissions').where({
    action: permission.action,
    resource: permission.resource
  }).first();
  if (!row) {
    const [id] = await knex('permissions').insert(permission);
    row = await knex('permissions').where({ id }).first();
  }
  return row;
}

async function addMissingGrantOptions(knex, permissionId, attributeIds) {
  const groups = await knex('permission_grant_groups')
    .where({ permission_id: permissionId })
    .orderBy('grant_group');
  const existing = await knex('permission_attributes')
    .where({ permission_id: permissionId })
    .select('grant_group', 'attribute_id');
  const existingAttributeIds = new Set(existing.map(row => Number(row.attribute_id)));
  const existingGroupNumbers = new Set(groups.map(row => Number(row.grant_group)));
  let nextGroup = groups.length
    ? Math.max(...groups.map(row => Number(row.grant_group))) + 1
    : 0;

  for (const attributeId of attributeIds) {
    if (existingAttributeIds.has(Number(attributeId))) continue;
    while (existingGroupNumbers.has(nextGroup)) nextGroup += 1;
    await knex('permission_grant_groups').insert({
      permission_id: permissionId,
      grant_group: nextGroup
    });
    await knex('permission_attributes').insert({
      permission_id: permissionId,
      attribute_id: attributeId,
      grant_group: nextGroup
    });
    existingGroupNumbers.add(nextGroup);
    existingAttributeIds.add(Number(attributeId));
    nextGroup += 1;
  }
}

exports.seed = async function seed(knex) {
  const attributesByName = new Map();
  for (const preset of Object.values(ACCESS_PRESETS)) {
    const attribute = await ensureAttribute(knex, preset);
    attributesByName.set(attribute.name, attribute.id);
  }

  const permissionsByKey = new Map();
  for (const permission of PERMISSION_CATALOG) {
    const row = await ensurePermission(knex, permission);
    permissionsByKey.set(`${row.action}:${row.resource}`, row);
  }

  for (const [permissionKey, alternatives] of Object.entries(PERMISSION_GRANTS)) {
    const permission = permissionsByKey.get(permissionKey);
    if (!permission) throw new Error(`Unknown permission in preset seed: ${permissionKey}`);
    for (const alternative of alternatives) {
      const attributeIds = alternative.map(name => {
        const id = attributesByName.get(name);
        if (!id) throw new Error(`Unknown preset attribute in seed: ${name}`);
        return id;
      });
      await addMissingGrantOptions(knex, permission.id, attributeIds);
    }
  }

  return {
    attributes: Object.fromEntries(attributesByName),
    permissions: Object.fromEntries(
      [...permissionsByKey.entries()].map(([key, value]) => [key, value.id])
    )
  };
};
