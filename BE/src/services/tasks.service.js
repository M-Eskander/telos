const taskRepo = require('../repositories/task.repo');
const knex = require('../config/knex');

async function getActiveAssigneeIds(trx, assigneeIds) {
  if (!Array.isArray(assigneeIds)) {
    const error = new TypeError('assignee_ids must be an array');
    error.code = 'INVALID_ASSIGNEES';
    throw error;
  }
  const ids = assigneeIds.map(Number);
  if (ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    const error = new TypeError('assignee_ids must contain unique positive user IDs');
    error.code = 'INVALID_ASSIGNEES';
    throw error;
  }
  if (ids.length === 0) return ids;
  const activeUsers = await trx('users')
    .whereIn('id', ids)
    .andWhere({ is_active: true })
    .select('id');
  if (activeUsers.length !== ids.length) {
    const error = new Error('Every assignee must be an active person');
    error.code = 'INVALID_ASSIGNEES';
    throw error;
  }
  return ids;
}

async function createTask(projectId, userId, data) {
  const task = await knex.transaction(async trx => {
    if (data.parent_task_id) {
      const parentTask = await trx('tasks')
        .where({ id: data.parent_task_id, project_id: projectId })
        .first();
      if (!parentTask) {
        const error = new Error('Parent task must belong to this project');
        error.code = 'INVALID_PARENT_TASK';
        throw error;
      }
    }
    const assigneeIds = data.assignee_ids === undefined
      ? []
      : await getActiveAssigneeIds(trx, data.assignee_ids);
    const taskData = {
      project_id: projectId,
      title: data.title,
      description: data.description || null,
      status: data.status || 'todo',
      priority: data.priority || 'medium',
      parent_task_id: data.parent_task_id || null,
      progress: data.progress || 0,
      weight: data.weight || 1.00,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      created_by: userId
    };

    const [id] = await trx('tasks').insert(taskData);
    const newTask = await trx('tasks').where({ id }).first();

    if (assigneeIds.length > 0) {
      const records = assigneeIds.map(uid => ({ task_id: id, user_id: uid }));
      await trx('task_assignment').insert(records);
    }

    // Trigger rollup calculation
    if (newTask.parent_task_id) {
      await recalculateParentProgress(newTask.parent_task_id, trx);
    } else {
      await recalculateProjectProgress(projectId, trx);
    }

    return newTask;
  });

  return taskRepo.findById(task.id);
}

async function getProjectTasks(projectId) {
  return await taskRepo.findByProject(projectId);
}

async function updateTask(id, data, projectId = null) {
  const updatedTask = await knex.transaction(async trx => {
    const taskQuery = trx('tasks').where({ id });
    if (projectId !== null && projectId !== undefined) taskQuery.andWhere({ project_id: projectId });
    const task = await taskQuery.first();
    if (!task) {
      if (projectId === null || projectId === undefined) {
        throw new Error('Task not found');
      }
      return null;
    }

    const allowedUpdates = {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      progress: data.progress,
      weight: data.weight,
      start_date: data.start_date,
      end_date: data.end_date
    };

    Object.keys(allowedUpdates).forEach(
      key => allowedUpdates[key] === undefined && delete allowedUpdates[key]
    );

    if (Object.keys(allowedUpdates).length > 0) {
      await trx('tasks').where({ id }).update(allowedUpdates);
    }

    if (data.assignee_ids !== undefined) {
      const assigneeIds = await getActiveAssigneeIds(trx, data.assignee_ids);
      await trx('task_assignment').where({ task_id: id }).del();
      if (assigneeIds.length > 0) {
        const records = assigneeIds.map(uid => ({ task_id: id, user_id: uid }));
        await trx('task_assignment').insert(records);
      }
    }

    // Trigger rollup calculation after update
    if (task.parent_task_id) {
      await recalculateParentProgress(task.parent_task_id, trx);
    } else {
      await recalculateProjectProgress(task.project_id, trx);
    }

    return trx('tasks').where({ id }).first();
  });

  if (!updatedTask) return null;
  return taskRepo.findById(updatedTask.id);
}
async function deleteTask(id, projectId = null) {
  if (projectId === null || projectId === undefined) return taskRepo.remove(id);
  return knex('tasks').where({ id, project_id: projectId }).del();
}

// Helper to recalculate and update parent task progress based on its subtasks
async function recalculateParentProgress(parentTaskId, trx) {
  if (!parentTaskId) return;

  const subtasks = await trx('tasks').where({ parent_task_id: parentTaskId });
  if (subtasks.length === 0) return;

  let totalWeight = 0;
  let weightedProgressSum = 0;

  for (const sub of subtasks) {
    const weight = Number(sub.weight) || 1;
    const progress = Number(sub.progress) || 0;
    totalWeight += weight;
    weightedProgressSum += progress * weight;
  }

  const newParentProgress = totalWeight > 0 ? Math.round(weightedProgressSum / totalWeight) : 0;

  // Update parent task progress
  await trx('tasks').where({ id: parentTaskId }).update({ progress: newParentProgress });

  // Fetch parent task to see if it has its own parent (multi-level support)
  const parentTask = await trx('tasks').where({ id: parentTaskId }).first();
  if (parentTask && parentTask.parent_task_id) {
    await recalculateParentProgress(parentTask.parent_task_id, trx);
  } else if (parentTask) {
    // If it's a root/parent task, update the project progress
    await recalculateProjectProgress(parentTask.project_id, trx);
  }
}

// Helper to recalculate and update overall project progress
async function recalculateProjectProgress(projectId, trx) {
  // Fetch all root tasks (tasks without parents) for the project
  const rootTasks = await trx('tasks').where({ project_id: projectId, parent_task_id: null });
  if (rootTasks.length === 0) {
    await trx('projects').where({ id: projectId }).update({ progress: 0 });
    return;
  }

  let totalWeight = 0;
  let weightedProgressSum = 0;

  for (const task of rootTasks) {
    const weight = Number(task.weight) || 1;
    const progress = Number(task.progress) || 0;
    totalWeight += weight;
    weightedProgressSum += progress * weight;
  }

  const newProjectProgress = totalWeight > 0 ? Math.round(weightedProgressSum / totalWeight) : 0;

  await trx('projects').where({ id: projectId }).update({ progress: newProjectProgress });
}

module.exports = {
  createTask,
  getProjectTasks,
  updateTask,
  deleteTask,
  recalculateParentProgress,
  recalculateProjectProgress
};