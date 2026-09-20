const knex = require('../config/knex');

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  );
}

async function getProjectByName(name) {
    return knex('projects').where({name}).first();
}

// created_by: userId is incorrect because we need cross user access on projects
async function getProjectById(id, userId = null) {
    const query = knex('projects').where({ id });
    if (userId) {
      query.andWhere({ created_by: userId });
    }
    return query.first();
}

async function insertProject(name, description, created_by, trx) {
    const q = trx || knex;
    const inserted = await q('projects').insert({ name, description, created_by });
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    return q('projects').where({ id }).first();
}

async function findOrCreate(name, description, created_by, trx) {
    const q = trx || knex;
    let p = await q('projects').where({ name }).first();
    if (!p) p = await insertProject(name, description, created_by, q);
    return p;
}

//same problem as the created_by in getProjectById
async function listProjects(userId = null) {
    const query = knex('projects');
    if (userId) {
      query.where({ created_by: userId });
    }
    return query.select('*');
}

async function deleteProject(id, userId = null) {
    const query = knex('projects').where({ id });
    if (userId) {
      query.andWhere({ created_by: userId });
    }
    return query.del();
}

async function updateProject(id, userId = null, data) {
  const cleanData = clean(data);
  const query = knex('projects').where({ id });
  if (userId) {
    query.andWhere({ created_by: userId });
  }
  return query.update(cleanData);
}

module.exports = { getProjectByName, getProjectById, insertProject, findOrCreate, listProjects, deleteProject, updateProject };