const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const taskRouter = require('./task.router');
const { checkPerm, requireAuthenticated } = require('../middleware/auth.middleware');

router.get('/', requireAuthenticated, projectController.listProjects);
router.post('/', checkPerm('create:project'), projectController.createProject);
router.get('/:id/departments', checkPerm('read:project', 'project'), projectController.listDepartments);
router.post('/:id/departments', checkPerm('update:project', 'project'), projectController.createDepartment);
router.delete('/:id/departments/:departmentId', checkPerm('update:project', 'project'), projectController.deleteDepartment);
router.get('/:id/members', checkPerm('read:project', 'project'), projectController.listMembers);
router.put('/:id/members/:userId', checkPerm('update:project', 'project'), projectController.assignMember);
router.delete('/:id/members/:userId', checkPerm('update:project', 'project'), projectController.removeMember);
router.get('/:id/timeline', checkPerm('read:project', 'project'), projectController.getProjectTimeline);
router.get('/:id', checkPerm('read:project', 'project'), projectController.getProjectById);
router.patch('/:id', checkPerm('update:project', 'project'), projectController.updateProject);
router.delete('/:id', checkPerm('delete:project', 'project'), projectController.deleteProject);
router.use('/:projectId/tasks', taskRouter);

module.exports = router;