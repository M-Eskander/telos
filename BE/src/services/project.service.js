const projectRepo = require('../repositories/project.repo');
const knex = require('../config/knex');
const { projectSummary, attentionFor, computeSchedule } = require('./schedule.service');

async function listProjects(userId = null) {
    return projectRepo.listProjects(userId);
}

async function createProject(name, description, created_by) {
    return projectRepo.insertProject(name, description, created_by);
}

async function getProjectById(id, userId = null) {
    return projectRepo.getProjectById(id, userId);
}

async function updateProject(id, userId = null, data) {
    const updated = await projectRepo.updateProject(id, userId, data);
    return updated ? projectRepo.getProjectById(id) : null;
}

async function deleteProject(id, userId = null) {
    return projectRepo.deleteProject(id, userId);
}

async function listProjectDepartments(projectId) {
    return projectRepo.listProjectDepartments(projectId);
}

async function createProjectDepartment(projectId, name) {
    return projectRepo.createProjectDepartment(projectId, name);
}

async function deleteProjectDepartment(projectId, departmentId) {
    return projectRepo.deleteProjectDepartment(projectId, departmentId);
}

async function listProjectMembers(projectId) {
    return projectRepo.listProjectMembers(projectId);
}

async function listAvailableProjectPeople(projectId) {
    return projectRepo.listAvailableProjectPeople(projectId);
}

async function assignProjectMember(projectId, userId, departmentId) {
    return projectRepo.assignProjectMember(projectId, userId, departmentId);
}

async function removeProjectMember(projectId, userId) {
    return projectRepo.removeProjectMember(projectId, userId);
}

// A health summary per project, for the portfolio view.
async function listProjectSummaries(projectIds, options = {}) {
  if (!projectIds.length) return new Map();
  const tasks = await knex('tasks').whereIn('project_id', projectIds).select('*');
  const userId = options.userId ? Number(options.userId) : null;
  const onlyMine = options.onlyMine === true;

  const byProject = new Map();
  for (const task of tasks) {
    if (!byProject.has(task.project_id)) byProject.set(task.project_id, []);
    byProject.get(task.project_id).push(task);
  }

  const summaries = new Map();
  for (const projectId of projectIds) {
    let projectTasks = byProject.get(projectId) || [];
    if (onlyMine && userId) {
      const assignments = await knex('task_assignment')
        .whereIn('task_id', projectTasks.map(task => task.id))
        .where({ user_id: userId })
        .select('task_id');
      const mine = new Set(assignments.map(row => row.task_id));
      projectTasks = projectTasks.filter(task => mine.has(task.id));
    }
    summaries.set(projectId, projectSummary(null, projectTasks));
  }
  return summaries;
}

// The work that needs a person, grouped by why.
async function projectAttention(projectId, options = {}) {
  const taskService = require('./tasks.service');
  const tasks = await taskService.getProjectTasks(projectId, {
    userId: options.userId,
    viewAll: options.viewAll !== false
  });
  const flat = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      flat.push(node);
      walk(node.subtasks || []);
    }
  };
  walk(tasks);
  const buckets = attentionFor(flat, { userId: options.userId });
  const summarise = (task) => ({
    id: task.id,
    title: task.title,
    progress: task.progress,
    parent_task_id: task.parent_task_id,
    end_date: task.end_date,
    due: task.due,
    schedule: task.schedule,
    assignees: (task.assignees || []).map(assignee => ({ id: assignee.id, name: assignee.name })),
    blocked: task.blocked
  });
  const result = {};
  for (const [key, list] of Object.entries(buckets)) {
    result[key] = list.map(summarise);
  }
  result.total = flat.length;
  return result;
}

module.exports = {
    listProjects,
    createProject,
    getProjectById,
    updateProject,
    deleteProject,
    listProjectDepartments,
    createProjectDepartment,
    deleteProjectDepartment,
    listProjectMembers,
    listAvailableProjectPeople,
    assignProjectMember,
    removeProjectMember,
    listProjectSummaries,
    projectAttention
};