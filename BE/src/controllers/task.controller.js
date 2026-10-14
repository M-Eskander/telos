const taskService = require('../services/tasks.service');

async function create(req, res, next) {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const task = await taskService.createTask(projectId, userId, req.body);
    return res.status(201).json({ success: true, data: task });
  } catch (error) {
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
    const { id } = req.params;
    const updatedTask = await taskService.updateTask(id, req.body);
    return res.status(200).json({ success: true, data: updatedTask });
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    await taskService.deleteTask(id);
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