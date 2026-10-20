const knex = require('../config/knex');
const bcrypt = require('bcryptjs');
const userRepo = require('../repositories/user.repo');
const roleRepo = require('../repositories/role.repo');
const userRoleRepo = require('../repositories/userRole.repo');

const ALLOWED_DEFAULT_ROLES = ['user'];

async function findUserByEmail(email) {
  return userRepo.findByEmail(email);
}

async function findUserById(id, trx) {
  return userRepo.findById(id, trx);
}

async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || !plain || typeof hash !== 'string' || !hash) return false;
  return bcrypt.compare(plain, hash);
}

async function getUserRoles(userId, trx) {
  return userRoleRepo.getRolesForUser(userId, trx);
}

async function getUserRoleAssignments(userId, trx) {
  return userRoleRepo.getRoleAssignmentsForUser(userId, trx);
}

async function isOwner(userId, trx) {
  const q = trx || knex;
  const owner = await q('owner_account').where({ id: 1, user_id: userId }).first();
  return !!owner;
}

async function bootstrapOwner({ name, phone_number, email, password }) {
  const hashed = await bcrypt.hash(password, 10);
  try {
    return await knex.transaction(async trx => {
      const ownerExists = await trx('owner_account').where({ id: 1 }).first();
      if (ownerExists) {
        const error = new Error('The owner account has already been created');
        error.code = 'OWNER_ALREADY_BOOTSTRAPPED';
        throw error;
      }

      const [userId] = await trx('users').insert({
        name,
        phone_number,
        email,
        password: hashed,
        created_at: new Date()
        // The owner is not exempt from verification: they must confirm their
        // email address before they can sign in for the first time.
      });
      let ownerRole = await trx('roles').where({ name: 'owner' }).first();
      if (!ownerRole) {
        const [roleId] = await trx('roles').insert({ name: 'owner' });
        ownerRole = await trx('roles').where({ id: roleId }).first();
      }
      await trx('user_roles').insert({ user_id: userId, role_id: ownerRole.id });

      let ownerAttribute = await trx('attributes')
        .where({ name: 'is_owner', resource: 'global' })
        .first();
      if (!ownerAttribute) {
        const [attributeId] = await trx('attributes').insert({
          name: 'is_owner',
          resource: 'global',
          description: 'Studio owner'
        });
        ownerAttribute = await trx('attributes').where({ id: attributeId }).first();
      }
      await trx('role_attributes').insert({
        role_id: ownerRole.id,
        attribute_id: ownerAttribute.id,
        resource_id: null,
        value: 'true'
      }).onConflict(['role_id', 'attribute_id', 'resource_id']).ignore();

      await trx('owner_account').insert({ id: 1, user_id: userId, created_at: new Date() });
      const owner = await userRepo.findById(userId, trx);
      owner.roles = ['owner'];
      owner.isOwner = true;
      delete owner.password;
      return owner;
    });
  } catch (error) {
    if (error.code === 'OWNER_ALREADY_BOOTSTRAPPED' ||
        (typeof error.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) ||
        error.code === 'ER_DUP_ENTRY') {
      const conflict = new Error('The owner account has already been created or the email is already in use');
      conflict.code = 'OWNER_ALREADY_BOOTSTRAPPED';
      throw conflict;
    }
    throw error;
  }
}

async function createUser({ name, phone_number, email, password, roles = ['user'] }) {
  const safeRoles = (roles || []).filter((roleName) => ALLOWED_DEFAULT_ROLES.includes(roleName));
  const hashed = password ? await bcrypt.hash(password, 10) : null;

  return knex.transaction(async (trx) => {
    const createdUser = await userRepo.insertUser({ name, phone_number, email, password: hashed, created_at: new Date() }, trx);
    const uid = createdUser.id;

    if (safeRoles.length === 0) {
      safeRoles.push('user');
    }

    for (const roleName of safeRoles) {
      const role = await roleRepo.findOrCreate(roleName, trx);
      await userRoleRepo.linkUserRole(uid, role.id, trx);
    }

    const created = await userRepo.findById(uid, trx);
    const userRoles = await getUserRoles(uid, trx);
    created.roles = userRoles;
    delete created.password;
    return created;
  });
}

module.exports = {
  findUserByEmail,
  findUserById,
  verifyPassword,
  getUserRoles,
  getUserRoleAssignments,
  createUser,
  isOwner,
  bootstrapOwner
};