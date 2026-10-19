const projectService = require('../services/project.service');
const pdpService = require('../services/pdp.service');
const taskService = require('../services/tasks.service');

function isConstraintError(error) {
    return typeof error.code === 'string' &&
        (error.code === 'ER_DUP_ENTRY' || error.code.startsWith('SQLITE_CONSTRAINT'));
}

function validPositiveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function ensureProjectExists(req, res) {
    const project = await projectService.getProjectById(req.params.id);
    if (!project) {
        res.status(404).json({ ok: false, message: 'Project not found' });
        return false;
    }
    return true;
}

exports.listProjects = async (req, res, next) => {
    try {
        const allProjects = await projectService.listProjects();
        if (req.user.isOwner === true) {
            return res.json({ ok: true, projects: allProjects });
        }
        const permissions = await Promise.all(allProjects.map(project =>
            pdpService.getEffectivePermissions(req.user.id, req.user.roles || [], {
                resourceId: project.id,
                resourceType: 'project',
                ownerId: project.created_by
            })
        ));
        const projects = allProjects.filter((project, index) =>
            permissions[index].includes('read:project')
        );
        return res.json({ ok: true, projects });
    } catch (err) {
        next(err);
    }
};

exports.createProject = async (req, res, next) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ ok: false, message: 'Project name is required' });
        const project = await projectService.createProject(name, description, req.user.id);
        res.status(201).json({ ok: true, project });
    } catch (err) {
        next(err);
    }
};

exports.getProjectById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const project = await projectService.getProjectById(id);
        if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });
        res.json({ ok: true, project });
    } catch (err) {
        next(err);
    }
};

exports.listDepartments = async (req, res, next) => {
    try {
        if (!await ensureProjectExists(req, res)) return;
        const departments = await projectService.listProjectDepartments(req.params.id);
        return res.json({ ok: true, departments });
    } catch (err) {
        return next(err);
    }
};

exports.createDepartment = async (req, res, next) => {
    try {
        if (!await ensureProjectExists(req, res)) return;
        const { name } = req.body || {};
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ ok: false, message: 'Department name is required' });
        }
        const department = await projectService.createProjectDepartment(req.params.id, name);
        return res.status(201).json({ ok: true, department });
    } catch (err) {
        if (isConstraintError(err)) {
            return res.status(409).json({ ok: false, message: 'Department already exists in this project' });
        }
        return next(err);
    }
};

exports.deleteDepartment = async (req, res, next) => {
    try {
        if (!await ensureProjectExists(req, res)) return;
        const departmentId = validPositiveId(req.params.departmentId);
        if (!departmentId) {
            return res.status(400).json({ ok: false, message: 'Department ID must be a positive integer' });
        }
        const deleted = await projectService.deleteProjectDepartment(req.params.id, departmentId);
        if (!deleted) return res.status(404).json({ ok: false, message: 'Department not found' });
        return res.json({ ok: true });
    } catch (err) {
        return next(err);
    }
};

exports.listMembers = async (req, res, next) => {
    try {
        if (!await ensureProjectExists(req, res)) return;
        const members = await projectService.listProjectMembers(req.params.id);
        return res.json({ ok: true, members });
    } catch (err) {
        return next(err);
    }
};

exports.assignMember = async (req, res, next) => {
    try {
        if (!await ensureProjectExists(req, res)) return;
        const userId = validPositiveId(req.params.userId);
        if (!userId) {
            return res.status(400).json({ ok: false, message: 'Person ID must be a positive integer' });
        }
        const { departmentId = null } = req.body || {};
        const normalizedDepartmentId = departmentId === null ? null : validPositiveId(departmentId);
        if (departmentId !== null && !normalizedDepartmentId) {
            return res.status(400).json({ ok: false, message: 'Department ID must be a positive integer or null' });
        }
        const member = await projectService.assignProjectMember(
            req.params.id,
            userId,
            normalizedDepartmentId
        );
        return res.json({ ok: true, member });
    } catch (err) {
        if (err instanceof TypeError) {
            return res.status(400).json({ ok: false, message: err.message });
        }
        return next(err);
    }
};

exports.removeMember = async (req, res, next) => {
    try {
        if (!await ensureProjectExists(req, res)) return;
        const userId = validPositiveId(req.params.userId);
        if (!userId) {
            return res.status(400).json({ ok: false, message: 'Person ID must be a positive integer' });
        }
        const deleted = await projectService.removeProjectMember(req.params.id, userId);
        if (!deleted) return res.status(404).json({ ok: false, message: 'Project member not found' });
        return res.json({ ok: true });
    } catch (err) {
        return next(err);
    }
};

exports.getProjectTimeline = async (req, res, next) => {
    try {
        if (!await ensureProjectExists(req, res)) return;
        const tasks = await taskService.getProjectTimeline(req.params.id);
        return res.json({ ok: true, tasks });
    } catch (err) {
        return next(err);
    }
};

exports.updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;

    const allowedFields = ['name', 'description'];
    const updateData = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    const project = await projectService.updateProject(id, null, updateData);
    if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });

    res.json({ ok: true, project });
  } catch (err) {
    next(err);
  }
};

exports.deleteProject = async (req, res, next) => {
    try {
        const { id } = req.params;
        const project = await projectService.deleteProject(id);
        if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });
        res.json({ ok: true, message: 'Project deleted successfully' });
    } catch (err) {
        next(err);
    }
};