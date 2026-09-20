const knex = require('../config/knex');

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  );
}

async function getProjectByName(name) {
    return knex('projects').where({name}).first();
}

async function getProjectById(id) {
    return knex('projects').where({id}).first();
}

async function insertProject(name, description, created_by, trx) {
    const q = trx || knex;
    await q('projects').insert({name, description, created_by});
    return q('projects').where({name}).first();
}

async function findOrCreate(name, description, trx) {
    let p = await (trx || knex)('projects').where({name}).first();
    if (!p) p = await insertProject(name, description, createdBy, trx);
    return p;
}

async function listProjects() {
    return knex('projects').select('*');
}

async function deleteProject(id) {
    return knex('projects').where({id}).del();
}

async function updateProject(id, data) {
  const cleanData = clean(data);
  return knex('projects').where({ id }).update(cleanData);
}

module.exports = { getProjectByName, getProjectById, insertProject, findOrCreate, listProjects, deleteProject, updateProject };