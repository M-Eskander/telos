const projectService = require('../services/project.service');

exports.listProjects = async (req, res, next) => {
    try {
        const projects = await projectService.listProjects(req.user.id);
        res.json({ ok: true, projects });
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
        const project = await projectService.getProjectById(id, req.user.id);
        if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });
        res.json({ ok: true, project });
    } catch (err) {
        next(err);
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

    const project = await projectService.updateProject(id, req.user.id, updateData);
    if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });

    res.json({ ok: true, project });
  } catch (err) {
    next(err);
  }
};

exports.deleteProject = async (req, res, next) => {
    try {
        const { id } = req.params;
        const project = await projectService.deleteProject(id, req.user.id);
        if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });
        res.json({ ok: true, message: 'Project deleted successfully' });
    } catch (err) {
        next(err);
    }
};