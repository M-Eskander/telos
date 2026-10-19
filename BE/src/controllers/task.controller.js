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
    next(error);
  }
}

async function getAllForProject(req, res, next) {
  try {
    const { projectId } = req.params;
    const tasks = await taskService.getProjectTasks(projectId);
    return res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const { id, projectId } = req.params;
    const updatedTask = await taskService.updateTask(id, req.body, projectId);
    if (!updatedTask) {
      return res.status(404).json({ success: false, message: 'Task not found in this project' });
    }
    return res.status(200).json({ success: true, data: updatedTask });
  } catch (error) {
    if (error.code === 'INVALID_ASSIGNEES') {
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
  remove
};