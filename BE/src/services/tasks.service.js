const taskRepo = require('../repositories/task.repo');
const knex = require('../config/knex');
const { isValidWeight, WEIGHT_MIN, WEIGHT_MAX } = require('../config/taskDerivation');
const {
  DEFAULT_WEIGHT,
  normalizeWeight,
  buildTaskTree,
  deriveTree,
  flattenDerived,
  projectProgress
} = require('./taskDerivation.service');
const { computeSchedule, relativeDay, isoDate } = require('./schedule.service');

function invalidTask(message) {
  const error = new TypeError(message);
  error.code = 'INVALID_TASK';
  throw error;
}

function taskAccessError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isAssignedTo(task, userId) {
  return (task.assignees || []).some(assignee => Number(assignee.id) === Number(userId));
}

// A member with view_own:task only receives assigned work.
//
// The whole tree is walked so any depth is supported. Only assigned tasks are
// returned. An assigned task keeps its place under the closest assigned
// ancestor; when no assigned ancestor exists it is promoted to a top-level row
// so the response never discloses a task the person is not working on.
function filterTasksForAssignee(tasks, userId) {
  const nodes = new Map();
  const depthOf = new Map();

  const collect = (list, parentId, depth) => {
    for (const node of list) {
      const entry = { ...node, subtasks: [] };
      nodes.set(node.id, entry);
      depthOf.set(node.id, depth);
      collect(node.subtasks || [], node.id, depth + 1);
    }
  };
  collect(tasks, null, 0);

  const assigned = [...nodes.values()].filter(node => isAssignedTo(node, userId));
  if (assigned.length === 0) return [];

  const parentIdOf = new Map();
  const collectParents = (list, parentId) => {
    for (const node of list) {
      parentIdOf.set(node.id, parentId);
      collectParents(node.subtasks || [], node.id);
    }
  };
  collectParents(tasks, null);

  const nearestAssignedAncestor = (node) => {
    let current = parentIdOf.get(node.id);
    while (current) {
      if (isAssignedTo(nodes.get(current), userId)) return current;
      current = parentIdOf.get(current);
    }
    return null;
  };

  const entries = new Map();
  const roots = [];
  const ordered = [...assigned].sort((a, b) => depthOf.get(a.id) - depthOf.get(b.id));

  for (const node of ordered) {
    const ancestorId = nearestAssignedAncestor(node);
    const parentEntry = ancestorId ? entries.get(ancestorId) : null;
    const entry = parentEntry
      ? { ...node, subtasks: [] }
      : {
        ...node,
        subtasks: [],
        parent_task_id: null,
        ...(parentIdOf.get(node.id) ? { is_subtask: true } : {})
      };
    entries.set(node.id, entry);
    if (parentEntry) parentEntry.subtasks.push(entry);
    else roots.push(entry);
  }

  // Flag tasks that are hiding unassigned children.
  const realChildCount = new Map();
  const countChildren = (list) => {
    for (const node of list) {
      const parent = parentIdOf.get(node.id);
      if (parent) realChildCount.set(parent, (realChildCount.get(parent) || 0) + 1);
      countChildren(node.subtasks || []);
    }
  };
  countChildren(tasks);

  for (const [id, entry] of entries) {
    const hidden = (realChildCount.get(id) || 0) - entry.subtasks.length;
    if (hidden > 0) entry.has_hidden_subtasks = true;
  }

  return roots;
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
  if (data.progress !== undefined &&
      (!Number.isInteger(data.progress) || data.progress < 0 || data.progress > 100)) {
    throw invalidTask('Task progress must be an integer from 0 to 100');
  }
  if (data.weight !== undefined && !isValidWeight(data.weight)) {
    throw invalidTask(`Task weight must be a number from ${WEIGHT_MIN} to ${WEIGHT_MAX}`);
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

async function countChildren(trx, taskId) {
  const children = await trx('tasks').where({ parent_task_id: taskId }).select('id');
  return children.length;
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
      status: 'todo',
      priority: 'low',
      parent_task_id: data.parent_task_id || null,
      progress: data.progress || 0,
      weight: data.weight === undefined ? DEFAULT_WEIGHT : normalizeWeight(data.weight),
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

    // Roll every derived value up through the tree.
    await recalculateProject(projectId, trx);

    return newTask;
  });

  return taskRepo.findById(task.id);
}

// Every task carries how it is doing against its dates, so the list, the
// attention view and the portfolio all speak the same language.
function decorateSchedule(nodes) {
  const all = [];
  const walk = (list) => {
    for (const node of list) {
      all.push(node);
      walk(node.subtasks || []);
    }
  };
  walk(nodes);
  const finished = new Set(
    all.filter(node => (Number(node.progress) || 0) >= 100).map(node => node.id)
  );
  for (const node of all) {
    const schedule = computeSchedule(node);
    node.schedule = {
      state: schedule.state,
      daysLeft: schedule.daysLeft,
      severity: schedule.severity
    };
    node.due = node.end_date
      ? { date: isoDate(node.end_date), relative: relativeDay(node.end_date) }
      : null;
    node.blocked = (node.depends_on || []).filter(id => !finished.has(id));
  }
  return nodes;
}

async function getProjectTasks(projectId, options = null) {
  const tasks = decorateSchedule(await taskRepo.findByProject(projectId));
  if (!options || options.viewAll === true) return tasks;
  return filterTasksForAssignee(tasks, options.userId);
}

async function getProjectTimeline(projectId, options = null) {
  const tasks = decorateSchedule(await taskRepo.findDatedByProject(projectId));
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

    const childCount = await countChildren(trx, task.id);
    const hasChildren = childCount > 0;

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
    }

    validateTaskData(data, task);

    // A task with subtasks is fully derived: its weight, progress, priority and
    // status come from them, so they cannot be edited directly.
    if (hasChildren) {
      if (data.progress !== undefined) {
        throw taskAccessError(
          'TASK_PROGRESS_CALCULATED',
          'Progress for this task is calculated from its subtasks'
        );
      }
      if (data.weight !== undefined) {
        throw taskAccessError(
          'TASK_WEIGHT_CALCULATED',
          'Weight for this task is calculated from its subtasks'
        );
      }
    }

    const allowedUpdates = {
      title: data.title,
      description: data.description,
      progress: data.progress,
      weight: data.weight,
      start_date: data.start_date,
      end_date: data.end_date
    };

    Object.keys(allowedUpdates).forEach(
      key => allowedUpdates[key] === undefined && delete allowedUpdates[key]
    );

    if (Object.keys(allowedUpdates).length > 0) {
      await trx('tasks').where({ id }).update({ ...allowedUpdates, updated_at: new Date() });
    }

    if (data.assignee_ids !== undefined) {
      const assigneeIds = await getActiveAssigneeIds(trx, task.project_id, data.assignee_ids);
      await trx('task_assignment').where({ task_id: id }).del();
      if (assigneeIds.length > 0) {
        const records = assigneeIds.map(uid => ({ task_id: id, user_id: uid }));
        await trx('task_assignment').insert(records);
      }
    }

    // Roll every derived value up through the tree.
    await recalculateProject(task.project_id, trx);

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

    // A parent that just lost its last subtask becomes a leaf again, so it
    // goes back to being an empty task of its own.
    if (task.parent_task_id) {
      const remainingChildren = await countChildren(trx, task.parent_task_id);
      if (remainingChildren === 0) {
        await trx('tasks').where({ id: task.parent_task_id }).update({
          progress: 0,
          weight: DEFAULT_WEIGHT
        });
      }
    }

    await recalculateProject(task.project_id, trx);
    return deleted;
  });
}

// Moves a task to a new parent and/or a new place among its siblings.
async function moveTask(id, data, projectId = null, options = {}) {
  const movedId = await knex.transaction(async trx => {
    const taskQuery = trx('tasks').where({ id });
    if (projectId !== null && projectId !== undefined) taskQuery.andWhere({ project_id: projectId });
    const task = await taskQuery.first();
    if (!task) return null;

    const parentId = data.parent_task_id === undefined
      ? task.parent_task_id
      : (data.parent_task_id === null ? null : Number(data.parent_task_id));

    if (parentId !== null) {
      if (!Number.isInteger(parentId) || parentId < 1) {
        throw invalidTask('parent_task_id must be a positive integer');
      }
      if (parentId === task.id) {
        throw invalidTask('A task cannot be its own parent');
      }
      const parent = await trx('tasks').where({ id: parentId, project_id: task.project_id }).first();
      if (!parent) throw invalidTask('Parent task must belong to this project');
      // Walking up from the new parent must not meet the task again.
      let cursor = parent;
      const seen = new Set();
      while (cursor && cursor.parent_task_id) {
        if (cursor.parent_task_id === task.id) {
          throw invalidTask('A task cannot be moved under its own subtask');
        }
        if (seen.has(cursor.id)) break;
        seen.add(cursor.id);
        cursor = await trx('tasks').where({ id: cursor.parent_task_id }).first();
      }
    }

    const siblings = await trx('tasks')
      .where({ project_id: task.project_id })
      .where({ parent_task_id: parentId })
      .whereNot({ id: task.id })
      .orderBy('position')
      .orderBy('id');
    const index = Number.isInteger(data.position)
      ? Math.max(0, Math.min(data.position, siblings.length))
      : siblings.length;
    siblings.splice(index, 0, task);

    for (const [order, sibling] of siblings.entries()) {
      await trx('tasks').where({ id: sibling.id }).update({
        parent_task_id: parentId,
        position: order + 1,
        updated_at: new Date()
      });
    }

    await recalculateProject(task.project_id, trx);
    return task.id;
  });
  // The read happens after the transaction, so it never waits on its own lock.
  return movedId ? taskRepo.findById(movedId) : null;
}

// Applies the same change to many tasks at once.
async function bulkUpdateTasks(projectId, ids, data, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw invalidTask('Choose at least one task');
  }
  const unique = [...new Set(ids.map(Number).filter(id => Number.isInteger(id) && id > 0))];
  const changed = await knex.transaction(async trx => {
    const tasks = await trx('tasks').where({ project_id: projectId }).whereIn('id', unique);
    if (tasks.length === 0) return [];

    const canManageTasks = options.canManageTasks !== false;
    const userId = options.userId || null;

    for (const task of tasks) {
      if (!canManageTasks) {
        const assigned = await trx('task_assignment')
          .where({ task_id: task.id, user_id: userId })
          .first();
        if (!assigned) {
          throw taskAccessError('TASK_NOT_ASSIGNED', 'You can only update tasks assigned to you');
        }
        if (Object.keys(data).some(key => key !== 'progress')) {
          throw taskAccessError('TASK_PROGRESS_ONLY', 'You can only update progress for these tasks');
        }
      }
      if (Object.prototype.hasOwnProperty.call(data, 'progress')) {
        const children = await countChildren(trx, task.id);
        if (children > 0) {
          throw taskAccessError(
            'TASK_PROGRESS_CALCULATED',
            'Progress for this task is calculated from its subtasks'
          );
        }
      }
    }

    // A bulk edit does not need a title: only the fields being changed matter.
    validateTaskData(data, {});
    const allowed = {};
    for (const key of ['title', 'description', 'progress', 'weight', 'start_date', 'end_date']) {
      if (data[key] !== undefined) allowed[key] = data[key];
    }
    if (Object.keys(allowed).length > 0) {
      await trx('tasks')
        .where({ project_id: projectId })
        .whereIn('id', tasks.map(task => task.id))
        .update({ ...allowed, updated_at: new Date() });
    }

    if (data.assignee_ids !== undefined) {
      const assigneeIds = await getActiveAssigneeIds(trx, projectId, data.assignee_ids);
      await trx('task_assignment')
        .whereIn('task_id', tasks.map(task => task.id))
        .del();
      if (assigneeIds.length > 0) {
        const records = [];
        for (const task of tasks) {
          for (const uid of assigneeIds) records.push({ task_id: task.id, user_id: uid });
        }
        await trx('task_assignment').insert(records);
      }
    }

    await recalculateProject(projectId, trx);
    return tasks.map(task => task.id);
  });
  return changed ? taskRepo.findByProject(projectId) : [];
}

// Sets the tasks a task depends on.
async function setDependencies(id, dependsOn, projectId = null) {
  if (!Array.isArray(dependsOn)) {
    throw invalidTask('depends_on must be an array of task IDs');
  }
  const unique = [...new Set(dependsOn.map(Number).filter(value => Number.isInteger(value) && value > 0))];
  const dependencyId = await knex.transaction(async trx => {
    const taskQuery = trx('tasks').where({ id });
    if (projectId !== null && projectId !== undefined) taskQuery.andWhere({ project_id: projectId });
    const task = await taskQuery.first();
    if (!task) return null;
    if (unique.includes(task.id)) throw invalidTask('A task cannot depend on itself');

    if (unique.length) {
      const others = await trx('tasks').where({ project_id: task.project_id }).whereIn('id', unique);
      if (others.length !== unique.length) {
        throw invalidTask('Every dependency must belong to this project');
      }
      // A dependency must not depend on this task, directly or in a chain.
      const reaches = async (fromId, targetId) => {
        const queue = [fromId];
        const seen = new Set();
        while (queue.length) {
          const current = queue.shift();
          if (seen.has(current)) continue;
          seen.add(current);
          if (current === targetId) return true;
          const rows = await trx('task_dependencies').where({ task_id: current }).select('depends_on_id');
          for (const row of rows) queue.push(row.depends_on_id);
        }
        return false;
      };
      for (const dependency of unique) {
        if (await reaches(dependency, task.id)) {
          throw invalidTask('That would create a circular dependency');
        }
      }
    }

    await trx('task_dependencies').where({ task_id: task.id }).del();
    if (unique.length) {
      await trx('task_dependencies').insert(unique.map(dependency => ({
        task_id: task.id,
        depends_on_id: dependency
      })));
    }
    await trx('tasks').where({ id: task.id }).update({ updated_at: new Date() });
    return task.id;
  });
  return dependencyId ? taskRepo.findById(dependencyId) : null;
}

// Recalculates every derived value in a project: task weight, priority,
// status and progress, plus the project progress.
async function recalculateProject(projectId, trx) {
  const tasks = await trx('tasks').where({ project_id: projectId }).select('*');
  if (tasks.length === 0) {
    await trx('projects').where({ id: projectId }).update({ progress: 0 });
    return;
  }
  const tree = buildTaskTree(tasks);
  const derivedRoots = deriveTree(tree);
  const derived = flattenDerived(derivedRoots);

  for (const node of derived) {
    const weight = normalizeWeight(node.derivedWeight);
    const progress = node.derivedProgress;
    const priority = node.derivedPriority;
    const status = node.derivedStatus;
    const changed =
      Number(node.weight) !== weight ||
      Number(node.progress) !== progress ||
      node.priority !== priority ||
      node.status !== status;
    if (!changed) continue;
    await trx('tasks').where({ id: node.id }).update({
      weight,
      progress,
      priority,
      status
    });
  }

  await trx('projects').where({ id: projectId }).update({
    progress: projectProgress(derivedRoots)
  });
}

module.exports = {
  createTask,
  getProjectTasks,
  getProjectTimeline,
  updateTask,
  deleteTask,
  moveTask,
  bulkUpdateTasks,
  setDependencies,
  decorateSchedule,
  recalculateProject
};
