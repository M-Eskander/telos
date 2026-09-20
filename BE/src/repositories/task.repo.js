const knex = require('../config/knex');

async function findById(id, userId = null) {
  const query = knex('tasks').where({ id });

  if (userId !== null && userId !== undefined) {
    query.andWhere({ created_by: userId });
  }

  return query.first();
}

module.exports = { findById };
