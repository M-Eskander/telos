const knex = require('../config/knex');

async function findById(id) {
  const task = await knex('tasks').where({ id }).first();
  if (!task) return null;
  
  task.assignees = await knex('task_assignment')
    .join('users', 'task_assignment.user_id', 'users.id')
    .where('task_assignment.task_id', id)
    .where('users.is_active', true)
    .select('users.id', 'users.name', 'users.email');

  task.subtasks = await knex('tasks')
    .where({ parent_task_id: id })
    .select('*');

  return task;
}

async function create(taskData) {
  const [id] = await knex('tasks').insert(taskData);
  return findById(id);
}

async function findByProject(projectId) {
  const parentTasks = await knex('tasks')
    .where({ project_id: projectId, parent_task_id: null })
    .select('*');

  for (let task of parentTasks) {
    task.assignees = await knex('task_assignment')
      .join('users', 'task_assignment.user_id', 'users.id')
      .where('task_assignment.task_id', task.id)
      .where('users.is_active', true)
      .select('users.id', 'users.name', 'users.email');

    task.subtasks = await knex('tasks')
      .where({ parent_task_id: task.id })
      .select('*');

    for (let subtask of task.subtasks) {
      subtask.assignees = await knex('task_assignment')
        .join('users', 'task_assignment.user_id', 'users.id')
        .where('task_assignment.task_id', subtask.id)
        .where('users.is_active', true)
        .select('users.id', 'users.name', 'users.email');
    }
  }

  return parentTasks;
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

  const taskIds = tasks.map(task => task.id);
  const assignments = await knex('task_assignment')
    .join('users', 'task_assignment.user_id', 'users.id')
    .whereIn('task_assignment.task_id', taskIds)
    .where('users.is_active', true)
    .select(
      'task_assignment.task_id as taskId',
      'users.id',
      'users.name',
      'users.email'
    );
  const assigneesByTask = new Map();
  for (const assignment of assignments) {
    if (!assigneesByTask.has(assignment.taskId)) assigneesByTask.set(assignment.taskId, []);
    assigneesByTask.get(assignment.taskId).push({
      id: assignment.id,
      name: assignment.name,
      email: assignment.email
    });
  }
  return tasks.map(task => ({
    ...task,
    assignees: assigneesByTask.get(task.id) || []
  }));
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
  setAssignees
};
