const knex = require('../config/knex');

async function attachAssignees(tasks) {
  if (tasks.length === 0) return tasks;
  const assignments = await knex('task_assignment')
    .join('users', 'task_assignment.user_id', 'users.id')
    .whereIn('task_assignment.task_id', tasks.map(task => task.id))
    .where('users.is_active', true)
    .select(
      'task_assignment.task_id as taskId',
      'users.id',
      'users.name',
      'users.email'
    );
  const byTask = new Map();
  for (const assignment of assignments) {
    if (!byTask.has(assignment.taskId)) byTask.set(assignment.taskId, []);
    byTask.get(assignment.taskId).push({
      id: assignment.id,
      name: assignment.name,
      email: assignment.email
    });
  }
  for (const task of tasks) {
    task.assignees = byTask.get(task.id) || [];
  }
  return tasks;
}

// Builds a nested tree. Subtasks can have subtasks of their own, so the tree
// is built from the full task list instead of a single level.
function nestTasks(tasks) {
  const nodes = new Map();
  for (const task of tasks) {
    nodes.set(task.id, { ...task, subtasks: [] });
  }
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parent_task_id ? nodes.get(node.parent_task_id) : null;
    if (parent) parent.subtasks.push(node);
    else roots.push(node);
  }
  // Siblings keep their deliberate order; the position column decides it.
  const byId = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || Number(a.id) - Number(b.id);
  for (const node of nodes.values()) node.subtasks.sort(byId);
  roots.sort(byId);
  return roots;
}

// A task depends on the tasks it cannot start before.
async function attachDependencies(tasks) {
  if (tasks.length === 0) return tasks;
  const rows = await knex('task_dependencies')
    .whereIn('task_id', tasks.map(task => task.id))
    .select('task_id', 'depends_on_id');
  const byTask = new Map();
  for (const row of rows) {
    if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
    byTask.get(row.task_id).push(row.depends_on_id);
  }
  for (const task of tasks) {
    task.depends_on = byTask.get(task.id) || [];
  }
  return tasks;
}

async function findById(id) {
  const task = await knex('tasks').where({ id }).first();
  if (!task) return null;

  const descendants = await knex('tasks').where({ project_id: task.project_id }).select('*');
  const tree = nestTasks(descendants);
  const find = (nodes) => {
    for (const node of nodes) {
      if (Number(node.id) === Number(id)) return node;
      const found = find(node.subtasks || []);
      if (found) return found;
    }
    return null;
  };
  const subtree = find(tree);
  if (!subtree) return null;

  const family = [subtree, ...collect(subtree)];
  await attachAssignees(family);
  await attachDependencies(family);
  return subtree;
}

function collect(node) {
  const all = [];
  for (const child of node.subtasks || []) {
    all.push(child, ...collect(child));
  }
  return all;
}

async function create(taskData) {
  const [id] = await knex('tasks').insert(taskData);
  return findById(id);
}

async function findByProject(projectId) {
  const tasks = await knex('tasks').where({ project_id: projectId }).select('*');
  if (tasks.length === 0) return [];
  await attachAssignees(tasks);
  await attachDependencies(tasks);
  return nestTasks(tasks);
}

async function findDatedByProject(projectId) {
  const tasks = await knex('tasks')
    .where({ project_id: projectId })
    .andWhere(function() {
      this.whereNotNull('start_date').orWhereNotNull('end_date');
    })
    .orderByRaw('COALESCE(start_date, end_date) ASC')
    .orderBy('end_date')
    .orderBy('id')
    .select('*');
  if (tasks.length === 0) return [];

  await attachAssignees(tasks);
  return tasks;
}

async function update(id, updateData) {
  await knex('tasks').where({ id }).update(updateData);
  return findById(id);
}

async function remove(id) {
  return knex('tasks').where({ id }).del();
}

async function setAssignees(taskId, userIds) {
  await knex('task_assignment').where({ task_id: taskId }).del();
  if (userIds && userIds.length > 0) {
    const records = userIds.map(userId => ({
      task_id: taskId,
      user_id: userId
    }));
    await knex('task_assignment').insert(records);
  }
  return findById(taskId);
}

module.exports = {
  create,
  findById,
  findByProject,
  findDatedByProject,
  update,
  remove,
  setAssignees,
  attachDependencies
};
