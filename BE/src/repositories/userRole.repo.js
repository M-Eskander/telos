const knex = require('../config/knex');

async function linkUserRole(userId, roleId, trx) {
  const q = trx || knex;
  try {
    await q('user_roles').insert({ user_id: userId, role_id: roleId });
  } catch (e) {
    // ignore duplicate errors
  }
}

async function unlinkUserRole(userId, roleId, trx) {
  const q = trx || knex;
  await q('user_roles').where({ user_id: userId, role_id: roleId }).del();
}

async function getRolesForUser(userId, trx) {
  const q = trx || knex;
  const rows = await q('user_roles')
    .join('roles', 'user_roles.role_id', 'roles.id')
    .where('user_roles.user_id', userId)
    .select('roles.name');
  return rows.map(r => r.name);
}

module.exports = { linkUserRole, getRolesForUser };
