const knex = require('../config/knex');

async function getAttributesByPermission(permissionId) {
  return knex('permission_attributes')
    .join('attributes', 'permission_attributes.attribute_id', 'attributes.id')
    .where({ permission_id: permissionId })
    .select('attributes.name');
}

async function getAllPermissionRequirements() {
  const results = await knex('permissions')
    .join('permission_grant_groups', 'permissions.id', 'permission_grant_groups.permission_id')
    .leftJoin('permission_attributes', function() {
      this.on('permission_attributes.permission_id', '=', 'permissions.id')
        .andOn('permission_attributes.grant_group', '=', 'permission_grant_groups.grant_group');
    })
    .leftJoin('attributes', 'permission_attributes.attribute_id', 'attributes.id')
    .select(
      'permissions.action',
      'permissions.resource as permission_resource',
      'permission_grant_groups.grant_group',
      'attributes.name',
      'attributes.resource as attribute_resource'
    );

  const requirements = {};
  results.forEach(row => {
    const key = `${row.action}:${row.permission_resource}`;
    if (!requirements[key]) requirements[key] = new Map();
    const groupId = row.grant_group === undefined || row.grant_group === null
      ? 0
      : row.grant_group;
    if (!requirements[key].has(groupId)) requirements[key].set(groupId, []);
    if (!row.name) return;
    requirements[key].get(groupId).push({
      name: row.name,
      resource: row.attribute_resource || row.permission_resource
    });
  });

  return Object.fromEntries(
    Object.entries(requirements).map(([permission, groups]) => [
      permission,
      groups.size > 0 ? Array.from(groups.values()) : [[]]
    ])
  );
}

async function insertOrUpdateAttributes(permissionId, attributes) {
  const attributeIds = await knex('attributes').whereIn('name', attributes || []).select('id');
  return replaceGrantGroups(permissionId, [attributeIds.map(attribute => attribute.id)]);
}

async function replaceGrantGroups(permissionId, groups) {
  if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group))) {
    throw new TypeError('Permission grants must be an array of attribute-id arrays');
  }
  const normalizedGroups = groups.map(group => {
    const normalized = group.map(attributeId => Number(attributeId));
    if (normalized.some(attributeId => !Number.isInteger(attributeId) || attributeId < 1) ||
        new Set(normalized).size !== normalized.length) {
      throw new TypeError('Grant attribute IDs must be unique positive integers within each rule');
    }
    return normalized;
  });

  const requestedIds = [...new Set(normalizedGroups.flat())];
  const knownAttributes = requestedIds.length
    ? await knex('attributes').whereIn('id', requestedIds).select('id')
    : [];
  if (knownAttributes.length !== requestedIds.length) {
    throw new Error('One or more permission grant attributes do not exist');
  }

  await knex.transaction(async trx => {
    await trx('permission_attributes').where({ permission_id: permissionId }).delete();
    await trx('permission_grant_groups').where({ permission_id: permissionId }).delete();
    if (normalizedGroups.length) {
      await trx('permission_grant_groups').insert(normalizedGroups.map((_, grantGroup) => ({
        permission_id: permissionId,
        grant_group: grantGroup
      })));
    }
    const inserts = normalizedGroups.flatMap((group, grantGroup) =>
      group.map(attributeId => ({
        permission_id: permissionId,
        attribute_id: attributeId,
        grant_group: grantGroup
      }))
    );
    if (inserts.length) await trx('permission_attributes').insert(inserts);
  });
  return getAllPermissionRequirements();
}

module.exports = {
  getAttributesByPermission,
  getAllPermissionRequirements,
  insertOrUpdateAttributes,
  replaceGrantGroups
};