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
  if (!hash) return plain === hash;
  return bcrypt.compare(plain, hash);
}

async function getUserRoles(userId, trx) {
  return userRoleRepo.getRolesForUser(userId, trx);
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
  createUser
};