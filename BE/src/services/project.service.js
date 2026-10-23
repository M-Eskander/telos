const projectRepo = require('../repositories/project.repo');
const knex = require('../config/knex');
const contractStorage = require('./contractStorage.service');
const projectContractService = require('./projectContract.service');
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

async function removeUploadedContractReplacedFiles(result) {
    for (const key of [result.oldPdf, result.oldWord]) {
        if (!key) continue;
        try {
            await contractStorage.removeContractFile(key);
        } catch (error) {
            console.error('Could not remove a replaced contract file:', error.message);
        }
    }
}

// Adding someone to a project and giving them the project contract is one
// action. The file is written first, the membership and contract row commit
// together, and the file is removed if either write fails.
async function addProjectMemberWithContract(projectId, userId, departmentId, file, actorId = null) {
    const stored = await contractStorage.storeContractFile(file);
    let uploaded;
    try {
        uploaded = await knex.transaction(async trx => {
            if (!await trx('projects').where({ id: projectId }).first()) {
                throw new TypeError('Project not found');
            }
            const user = await trx('users').where({ id: userId }).first();
            if (!user || user.is_active === false || Number(user.is_active) === 0) {
                throw new TypeError('An active person is required for project membership');
            }
            if (departmentId !== null &&
                !await trx('project_departments').where({ id: departmentId, project_id: projectId }).first()) {
                throw new TypeError('Department must belong to this project');
            }
            if (await trx('project_memberships').where({ project_id: projectId, user_id: userId }).first()) {
                throw new TypeError('This person is already a member of the project');
            }
            await trx('project_memberships').insert({
                project_id: projectId,
                user_id: userId,
                department_id: departmentId,
                updated_at: new Date()
            });
            return projectContractService.upsertUploadedContract(
                projectId,
                userId,
                file,
                actorId,
                { trx, storedFile: stored }
            );
        });
    } catch (error) {
        try {
            await contractStorage.removeContractFile(stored.storageKey);
        } catch (cleanupError) {
            console.error('Could not remove a failed contract upload:', cleanupError.message);
        }
        throw error;
    }

    await removeUploadedContractReplacedFiles(uploaded);
    const members = await projectRepo.listProjectMembers(projectId);
    return members.find(member => member.userId === Number(userId));
}

// A member who was added before their contract was ready can attach it now.
async function attachProjectMemberContract(projectId, userId, file, actorId = null) {
    return projectContractService.upsertUploadedContract(projectId, userId, file, actorId);
}

async function removeProjectMember(projectId, userId) {
    return projectRepo.removeProjectMember(projectId, userId);
}

// The projects a person can see, with their permissions resolved.
async function listVisibleProjects(user) {
    const all = await projectRepo.listProjects();
    if (user.isOwner === true) {
        return all.map(project => ({ ...project, permissions: ['*'] }));
    }
    const pdpService = require('./pdp.service');
    const resolved = await Promise.all(all.map(async (project) => {
        const permissions = await pdpService.getEffectivePermissions(user.id, user.roles || [], {
            resourceId: project.id,
            resourceType: 'project',
            ownerId: project.created_by
        });
        return { ...project, permissions };
    }));
    return resolved.filter(project => project.permissions.includes('read:project'));
}

// What needs this person, across every project they can see.
async function globalAttention(user) {
    const projects = await listVisibleProjects(user);
    const buckets = { overdue: [], due_soon: [], unassigned: [], stale: [], blocked: [] };
    for (const project of projects) {
        const viewOwn = project.permissions.includes('view_own:task');
        const attention = await projectAttention(project.id, {
            userId: user.id,
            viewAll: !viewOwn,
            onlyMine: viewOwn
        });
        for (const key of Object.keys(buckets)) {
            for (const item of attention[key]) {
                buckets[key].push({
                    ...item,
                    project_id: project.id,
                    project_name: project.name
                });
            }
        }
    }
    const bySeverity = (a, b) => (b.schedule?.severity || 0) - (a.schedule?.severity || 0);
    for (const key of Object.keys(buckets)) buckets[key].sort(bySeverity);
    buckets.projects = projects.length;
    return buckets;
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
    addProjectMemberWithContract,
    attachProjectMemberContract,
    removeProjectMember,
    listProjectSummaries,
    projectAttention,
    listVisibleProjects,
    globalAttention
};