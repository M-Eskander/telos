const taskRepo = require('../repositories/task.repo');
const knex = require('../config/knex');
async function createTask(projectId, userId, data) {
  // Use a transaction so task creation and assignee insertion happen together
  const task = await knex.transaction(async trx => {
    const taskData = {
      project_id: projectId,
      title: data.title,
      description: data.description || null,
      status: data.status || 'todo',
      priority: data.priority || 'medium',
      parent_task_id: data.parent_task_id || null,
      progress: data.progress || 0,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      created_by: userId
    };

    const newTask = await taskRepo.create(taskData, trx);

    // If assignee_ids are provided, insert them right away
    if (data.assignee_ids && data.assignee_ids.length > 0) {
      await taskRepo.setAssignees(newTask.id, data.assignee_ids, trx);
    }

    return newTask;
  });

  return taskRepo.findById(task.id);
}

async function getProjectTasks(projectId) {
  return await taskRepo.findByProject(projectId);
}

async function updateTask(id, data) {
  const updatedTask = await knex.transaction(async trx => {
    const allowedUpdates = {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      progress: data.progress,
      start_date: data.start_date,
      end_date: data.end_date
    };

    Object.keys(allowedUpdates).forEach(
      key => allowedUpdates[key] === undefined && delete allowedUpdates[key]
    );

    if (Object.keys(allowedUpdates).length > 0) {
      await taskRepo.update(id, allowedUpdates, trx);
    }

    // Update assignees if provided in the payload
    if (data.assignee_ids) {
      await taskRepo.setAssignees(id, data.assignee_ids, trx);
    }

    return taskRepo.findById(id);
  });

  return updatedTask;
}

async function deleteTask(id) {
  return await taskRepo.remove(id);
}

module.exports = {
  createTask,
  getProjectTasks,
  updateTask,
  deleteTask
};