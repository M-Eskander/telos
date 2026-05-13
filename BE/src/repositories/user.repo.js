const knex = require('../config/knex');

async function findByEmail(email) {
  return knex('users').where({ email }).first();
}

async function findById(id, trx) {
  const q = trx || knex;
  return q('users').where({ id }).first();
}

async function insertUser(user, trx) {
  const q = trx || knex;
  await q('users').insert(user);
  return q('users').where({ email: user.email }).first();
}

module.exports = { findByEmail, findById, insertUser };
