const knex = require('../config/knex');

async function getAttributesByPermission(permissionId) {
  return knex('permission_attributes')
    .join('attributes', 'permission_attributes.attribute_id', 'attributes.id')
    .where({ permission_id: permissionId })
    .select('attributes.name');
}

async function getAllPermissionRequirements() {
  const results = await knex('permissions')
    .join('permission_attributes', 'permissions.id', 'permission_attributes.permission_id')
    .join('attributes', 'permission_attributes.attribute_id', 'attributes.id')
    .select('permissions.action', 'permissions.resource', 'attributes.name');

  const requirements = {};
  results.forEach(row => {
    const key = `${row.action}:${row.resource}`;
    if (!requirements[key]) requirements[key] = [];
    requirements[key].push(row.name);
  });
  return requirements;
}

async function insertOrUpdateAttributes(permissionId, attributes) {
  // attributes is an array of attribute names
  // First, delete existing
  await knex('permission_attributes').where({ permission_id: permissionId }).delete();

  // Then insert new
  if (attributes && attributes.length > 0) {
    const attributeIds = await knex('attributes').whereIn('name', attributes).select('id');
    const inserts = attributeIds.map(attr => ({ permission_id: permissionId, attribute_id: attr.id }));
    await knex('permission_attributes').insert(inserts);
  }
  return getAttributesByPermission(permissionId);
}

module.exports = {
  getAttributesByPermission,
  getAllPermissionRequirements,
  insertOrUpdateAttributes
};