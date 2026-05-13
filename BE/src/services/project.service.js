const knex = require('../config/knex');
const projectRepo = require('../repositories/project.repo');

async function listProjects() {
    return projectRepo.listProjects();
}

async function createProject(name, description, created_by) {
    return projectRepo.insertProject(name, description, created_by);
}

async function getProjectById(id) {
    return projectRepo.getProjectById(id);
}

async function updateProject(id, data) {
    return projectRepo.updateProject(id, data);
}

async function deleteProject(id) {
    return projectRepo.deleteProject(id);
}

module.exports = { listProjects, createProject, getProjectById, updateProject, deleteProject};