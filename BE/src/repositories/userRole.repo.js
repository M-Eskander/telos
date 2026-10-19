const knex = require('../config/knex');

async function linkUserRole(userId, roleId, trx, scope = {}) {
  const q = trx || knex;
  await q('user_roles').insert({
    user_id: userId,
    role_id: roleId,
    resource_type: scope.resourceType || null,
    resource_id: scope.resourceId || null,
    scope_key: scope.resourceType ? `${scope.resourceType}:${scope.resourceId}` : ''
  }).onConflict(['user_id', 'role_id', 'scope_key']).ignore();
}

async function unlinkUserRole(userId, roleId, trx, scope = {}) {
  const q = trx || knex;
  await q('user_roles').where({
    user_id: userId,
    role_id: roleId,
    resource_type: scope.resourceType || null,
    resource_id: scope.resourceId || null,
    scope_key: scope.resourceType ? `${scope.resourceType}:${scope.resourceId}` : ''
  }).del();
}

async function getRolesForUser(userId, trx) {
  const assignments = await getRoleAssignmentsForUser(userId, trx);
  return assignments.map(assignment => assignment.name);
}

async function getRoleAssignmentsForUser(userId, trx) {
  const q = trx || knex;
  const rows = await q('user_roles')
    .join('roles', 'user_roles.role_id', 'roles.id')
    .where('user_roles.user_id', userId)
    .select(
      'roles.name',
      'user_roles.resource_type as resourceType',
      'user_roles.resource_id as resourceId'
    );
  return rows;
}

module.exports = { linkUserRole, unlinkUserRole, getRolesForUser, getRoleAssignmentsForUser };
