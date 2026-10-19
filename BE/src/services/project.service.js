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

async function assignProjectMember(projectId, userId, departmentId) {
    return projectRepo.assignProjectMember(projectId, userId, departmentId);
}

async function removeProjectMember(projectId, userId) {
    return projectRepo.removeProjectMember(projectId, userId);
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
    assignProjectMember,
    removeProjectMember
};