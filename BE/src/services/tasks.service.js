const taskRepo = require('../repositories/task.repo');
const knex = require('../config/knex');
const TASK_STATUSES = new Set(['todo', 'in_progress', 'done']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

function invalidTask(message) {
  const error = new TypeError(message);
  error.code = 'INVALID_TASK';
  return error;
}

function taskAccessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isAssignedTo(task, userId) {
  return (task.assignees || []).some(assignee => Number(assignee.id) === Number(userId));
}

// A member with view_own:task only receives assigned work. Assigned subtasks
// are promoted to top-level rows when their parent is not assigned, so the
// response never discloses an unassigned task.
function filterTasksForAssignee(tasks, userId) {
  const filtered = [];
  for (const task of tasks) {
    const taskAssigned = isAssignedTo(task, userId);
    const assignedSubtasks = (task.subtasks || []).filter(subtask => isAssignedTo(subtask, userId));

    if (taskAssigned) {
      const hiddenSubtasks = (task.subtasks || []).length - assignedSubtasks.length;
      filtered.push({
        ...task,
        subtasks: assignedSubtasks,
        ...(hiddenSubtasks > 0 ? { has_hidden_subtasks: true } : {})
      });
      continue;
    }

    for (const subtask of assignedSubtasks) {
      filtered.push({
        ...subtask,
        parent_task_id: null,
        subtasks: [],
        is_subtask: true
      });
    }
  }
  return filtered;
}

function filterTimelineForAssignee(tasks, userId) {
  return tasks.filter(task => isAssignedTo(task, userId));
}

function isValidDate(value) {
  return value === null || (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}

function validateTaskData(data, existingTask = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw invalidTask('Task data must be an object');
  }
  if (existingTask === null && (typeof data.title !== 'string' || !data.title.trim())) {
    throw invalidTask('Task title is required');
  }
  if (data.title !== undefined && (typeof data.title !== 'string' || !data.title.trim())) {
    throw invalidTask('Task title must be a non-empty string');
  }
  if (data.description !== undefined && data.description !== null &&
      typeof data.description !== 'string') {
    throw invalidTask('Task description must be a string or null');
  }
  if (data.status !== undefined &&
      (typeof data.status !== 'string' || !TASK_STATUSES.has(data.status))) {
    throw invalidTask('Task status must be todo, in_progress, or done');
  }
  if (data.priority !== undefined &&
      (typeof data.priority !== 'string' || !TASK_PRIORITIES.has(data.priority))) {
    throw invalidTask('Task priority must be low, medium, high, or critical');
  }
  if (data.progress !== undefined &&
      (!Number.isInteger(data.progress) || data.progress < 0 || data.progress > 100)) {
    throw invalidTask('Task progress must be an integer from 0 to 100');
  }
  if (data.weight !== undefined &&
      (typeof data.weight !== 'number' || !Number.isFinite(data.weight) || data.weight <= 0)) {
    throw invalidTask('Task weight must be a positive finite number');
  }
  if (data.parent_task_id !== undefined && data.parent_task_id !== null &&
      (!Number.isInteger(Number(data.parent_task_id)) || Number(data.parent_task_id) < 1)) {
    throw invalidTask('parent_task_id must be a positive integer');
  }
  for (const field of ['start_date', 'end_date']) {
    if (data[field] !== undefined && !isValidDate(data[field])) {
      throw invalidTask(`${field} must be a valid YYYY-MM-DD date or null`);
    }
  }
  const startDate = data.start_date === undefined
    ? existingTask && existingTask.start_date
    : data.start_date;
  const endDate = data.end_date === undefined
    ? existingTask && existingTask.end_date
    : data.end_date;
  if (startDate && endDate && endDate < startDate) {
    throw invalidTask('end_date must be on or after start_date');
  }
}

async function getActiveAssigneeIds(trx, projectId, assigneeIds) {
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
  const projectMembers = await trx('project_memberships')
    .where({ project_id: projectId })
    .whereIn('user_id', ids)
    .select('user_id');
  if (projectMembers.length !== ids.length) {
    const error = new Error('Every assignee must be assigned to this project');
    error.code = 'INVALID_ASSIGNEES';
    throw error;
  }
  return ids;
}

async function createTask(projectId, userId, data) {
  validateTaskData(data);
  const task = await knex.transaction(async trx => {
    if (data.parent_task_id !== undefined && data.parent_task_id !== null) {
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
      : await getActiveAssigneeIds(trx, projectId, data.assignee_ids);
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

async function getProjectTasks(projectId, options = null) {
  const tasks = await taskRepo.findByProject(projectId);
  if (!options || options.viewAll === true) return tasks;
  return filterTasksForAssignee(tasks, options.userId);
}

async function getProjectTimeline(projectId, options = null) {
  const tasks = await taskRepo.findDatedByProject(projectId);
  if (!options || options.viewAll === true) return tasks;
  return filterTimelineForAssignee(tasks, options.userId);
}

async function updateTask(id, data, projectId = null, options = {}) {
  const canManageTasks = options.canManageTasks !== false;
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

    if (!canManageTasks) {
      if (!options.userId) {
        throw taskAccessError('TASK_NOT_ASSIGNED', 'You can only update tasks assigned to you');
      }
      const assignment = await trx('task_assignment')
        .where({ task_id: task.id, user_id: options.userId })
        .first();
      if (!assignment) {
        throw taskAccessError('TASK_NOT_ASSIGNED', 'You can only update tasks assigned to you');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        validateTaskData(data, task);
      }
      if (Object.keys(data).some(key => key !== 'progress')) {
        throw taskAccessError('TASK_PROGRESS_ONLY', 'You can only update progress for this task');
      }
      const subtasks = await trx('tasks')
        .where({ parent_task_id: task.id })
        .count({ count: '*' })
        .first();
      if (Number(subtasks.count) > 0) {
        throw taskAccessError(
          'TASK_PROGRESS_CALCULATED',
          'Progress for this task is calculated from its subtasks'
        );
      }
    }

    validateTaskData(data, task);

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
      const assigneeIds = await getActiveAssigneeIds(trx, task.project_id, data.assignee_ids);
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
  return knex.transaction(async trx => {
    const taskQuery = trx('tasks').where({ id });
    if (projectId !== null && projectId !== undefined) {
      taskQuery.andWhere({ project_id: projectId });
    }
    const task = await taskQuery.first();
    if (!task) return 0;

    const deleted = await trx('tasks').where({ id: task.id }).del();
    if (!deleted) return 0;
    if (task.parent_task_id) {
      await recalculateParentProgress(task.parent_task_id, trx);
    } else {
      await recalculateProjectProgress(task.project_id, trx);
    }
    return deleted;
  });
}

// Helper to recalculate and update parent task progress based on its subtasks
async function recalculateParentProgress(parentTaskId, trx) {
  if (!parentTaskId) return;

  const subtasks = await trx('tasks').where({ parent_task_id: parentTaskId });
  if (subtasks.length === 0) {
    await trx('tasks').where({ id: parentTaskId }).update({ progress: 0 });
    const parentTask = await trx('tasks').where({ id: parentTaskId }).first();
    if (parentTask && parentTask.parent_task_id) {
      await recalculateParentProgress(parentTask.parent_task_id, trx);
    } else if (parentTask) {
      await recalculateProjectProgress(parentTask.project_id, trx);
    }
    return;
  }

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
  getProjectTimeline,
  updateTask,
  deleteTask,
  recalculateParentProgress,
  recalculateProjectProgress
};