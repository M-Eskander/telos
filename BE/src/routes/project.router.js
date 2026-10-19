const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const taskRouter = require('./task.router');
const { checkPerm, requireAuthenticated } = require('../middleware/auth.middleware');

router.get('/', requireAuthenticated, projectController.listProjects);
router.post('/', checkPerm('create:project'), projectController.createProject);
router.get('/:id', checkPerm('read:project', 'project'), projectController.getProjectById);
router.patch('/:id', checkPerm('update:project', 'project'), projectController.updateProject);
router.delete('/:id', checkPerm('delete:project', 'project'), projectController.deleteProject);
router.use('/:projectId/tasks', taskRouter);

module.exports = router;