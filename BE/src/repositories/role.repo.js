const knex = require('../config/knex');

async function findByName(name) {
  return knex('roles').where({ name }).first();
}

async function insertRole(name, trx) {
  const q = trx || knex;
  await q('roles').insert({ name });
  return q('roles').where({ name }).first();
}

async function findOrCreate(name, trx) {
  let r = await (trx || knex)('roles').where({ name }).first();
  if (!r) r = await insertRole(name, trx);
  return r;
}

module.exports = { findByName, insertRole, findOrCreate };
