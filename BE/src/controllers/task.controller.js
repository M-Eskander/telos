const taskService = require('../services/tasks.service');

async function create(req, res, next) {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const task = await taskService.createTask(projectId, userId, req.body);
    return res.status(201).json({ success: true, data: task });
  } catch (error) {
    if (error.code === 'INVALID_ASSIGNEES') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === 'INVALID_PARENT_TASK') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === 'INVALID_TASK') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
}

// Move a task to a new parent and/or a new position among its siblings.
async function move(req, res, next) {
  try {
    const { id, projectId } = req.params;
    const moved = await taskService.moveTask(id, req.body || {}, projectId, {
      canManageTasks: req.user?.isOwner === true || (req.effectivePermissions || []).includes('manage:task')
    });
    if (!moved) {
      return res.status(404).json({ success: false, message: 'Task not found in this project' });
    }
    return res.status(200).json({ success: true, data: moved });
  } catch (error) {
    if (error.code === 'INVALID_TASK') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// Apply one change to many tasks.
async function bulk(req, res, next) {
  try {
    const { projectId } = req.params;
    const { ids, ...data } = req.body || {};
    const tasks = await taskService.bulkUpdateTasks(projectId, ids, data, {
      canManageTasks: req.user?.isOwner === true || (req.effectivePermissions || []).includes('manage:task'),
      userId: req.user?.id
    });
    return res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    if (error.code === 'INVALID_TASK') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === 'TASK_NOT_ASSIGNED' || error.code === 'TASK_PROGRESS_ONLY') {
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.code === 'TASK_PROGRESS_CALCULATED') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === 'INVALID_ASSIGNEES') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// Set the tasks a task depends on.
async function setDependencies(req, res, next) {
  try {
    const { id, projectId } = req.params;
    const { depends_on: dependsOn } = req.body || {};
    const task = await taskService.setDependencies(id, dependsOn, projectId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found in this project' });
    }
    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    if (error.code === 'INVALID_TASK') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

function isRestrictedToOwnTasks(req) {
  return req.user?.isOwner !== true &&
    (req.effectivePermissions || []).includes('view_own:task');
}

async function getAllForProject(req, res, next) {
  try {
    const { projectId } = req.params;
    const tasks = await taskService.getProjectTasks(projectId, {
      userId: req.user?.id,
      viewAll: !isRestrictedToOwnTasks(req)
    });
    return res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const { id, projectId } = req.params;
    const canManageTasks = req.user?.isOwner === true ||
      (req.effectivePermissions || []).includes('manage:task');
    const updatedTask = await taskService.updateTask(id, req.body, projectId, {
      userId: req.user?.id,
      canManageTasks
    });
    if (!updatedTask) {
      return res.status(404).json({ success: false, message: 'Task not found in this project' });
    }
    return res.status(200).json({ success: true, data: updatedTask });
  } catch (error) {
    if (error.code === 'INVALID_ASSIGNEES') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === 'INVALID_TASK') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === 'TASK_NOT_ASSIGNED' ||
        error.code === 'TASK_PROGRESS_ONLY') {
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.code === 'TASK_PROGRESS_CALCULATED' ||
        error.code === 'TASK_WEIGHT_CALCULATED') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const { id, projectId } = req.params;
    const deleted = await taskService.deleteTask(id, projectId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Task not found in this project' });
    }
    return res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  create,
  getAllForProject,
  update,
  remove,
  move,
  bulk,
  setDependencies
};