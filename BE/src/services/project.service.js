const projectRepo = require('../repositories/project.repo');

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
    return projectRepo.updateProject(id, userId, data);
}

async function deleteProject(id, userId = null) {
    return projectRepo.deleteProject(id, userId);
}

module.exports = { listProjects, createProject, getProjectById, updateProject, deleteProject};