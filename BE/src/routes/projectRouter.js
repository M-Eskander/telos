const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const { checkPerm } = require('../middleware/auth.middleware');

router.get('/', checkPerm('read', 'project' ), projectController.listProjects);
router.post('/', checkPerm('create', 'project'), projectController.createProject);
router.get('/:id', checkPerm('read', 'project'), projectController.getProjectById);
router.patch('/:id', checkPerm('update', 'project'), projectController.updateProject);
router.delete('/:id', checkPerm('delete', 'project'), projectController.deleteProject);

module.exports = router;