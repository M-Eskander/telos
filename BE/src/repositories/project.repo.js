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

async function listProjectDepartments(projectId) {
  return knex('project_departments')
    .where({ project_id: projectId })
    .select('id', 'project_id as projectId', 'name')
    .orderBy('name');
}

async function createProjectDepartment(projectId, name) {
  const [id] = await knex('project_departments').insert({
    project_id: projectId,
    name: name.trim()
  });
  return knex('project_departments')
    .where({ id })
    .select('id', 'project_id as projectId', 'name')
    .first();
}

async function deleteProjectDepartment(projectId, departmentId) {
  return knex.transaction(async trx => {
    const department = await trx('project_departments')
      .where({ project_id: projectId, id: departmentId })
      .first();
    if (!department) return 0;
    await trx('project_memberships')
      .where({ project_id: projectId, department_id: departmentId })
      .update({ department_id: null, updated_at: new Date() });
    return trx('project_departments')
      .where({ project_id: projectId, id: departmentId })
      .delete();
  });
}

async function listProjectMembers(projectId) {
  return knex('project_memberships')
    .join('users', 'project_memberships.user_id', 'users.id')
    .leftJoin('project_departments', 'project_memberships.department_id', 'project_departments.id')
    .where({ 'project_memberships.project_id': projectId })
    .andWhere({ 'users.is_active': true })
    .select(
      'users.id as userId',
      'users.name',
      'users.email',
      'users.phone_number as phoneNumber',
      'project_memberships.project_id as projectId',
      'project_memberships.department_id as departmentId',
      'project_departments.name as departmentName'
    )
    .orderBy('users.name');
}

async function listAvailableProjectPeople(projectId) {
  const memberIds = knex('project_memberships')
    .select('user_id')
    .where({ project_id: projectId });
  return knex('users')
    .where({ is_active: true })
    .whereNotIn('id', memberIds)
    .select('id', 'name', 'email')
    .orderBy('name');
}

async function assignProjectMember(projectId, userId, departmentId = null) {
  await knex.transaction(async trx => {
    if (!await trx('projects').where({ id: projectId }).first()) {
      throw new TypeError('Project not found');
    }
    const user = await trx('users').where({ id: userId }).first();
    if (!user || user.is_active === false || Number(user.is_active) === 0) {
      throw new TypeError('An active person is required for project membership');
    }
    if (departmentId !== null &&
        !await trx('project_departments').where({ id: departmentId, project_id: projectId }).first()) {
      throw new TypeError('Department must belong to this project');
    }

    await trx('project_memberships')
      .insert({
        project_id: projectId,
        user_id: userId,
        department_id: departmentId,
        updated_at: new Date()
      })
      .onConflict(['project_id', 'user_id'])
      .merge(['department_id', 'updated_at']);
  });

  const members = await listProjectMembers(projectId);
  return members.find(member => member.userId === Number(userId));
}

async function removeProjectMember(projectId, userId) {
  return knex.transaction(async trx => {
    const removed = await trx('project_memberships')
      .where({ project_id: projectId, user_id: userId })
      .delete();
    if (!removed) return 0;

    const projectTaskIds = trx('tasks')
      .select('id')
      .where({ project_id: projectId });
    await trx('task_assignment')
      .where({ user_id: userId })
      .whereIn('task_id', projectTaskIds)
      .delete();

    return removed;
  });
}

module.exports = {
  getProjectByName,
  getProjectById,
  insertProject,
  findOrCreate,
  listProjects,
  deleteProject,
  updateProject,
  listProjectDepartments,
  createProjectDepartment,
  deleteProjectDepartment,
  listProjectMembers,
  listAvailableProjectPeople,
  assignProjectMember,
  removeProjectMember
};