const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const taskRouter = require('./task.router');
const { checkPerm, requireAuthenticated } = require('../middleware/auth.middleware');

router.get('/', requireAuthenticated, projectController.listProjects);
router.post('/', checkPerm('create:project'), projectController.createProject);
router.get('/:id/departments', checkPerm('read:team', 'project'), projectController.listDepartments);
router.post('/:id/departments', checkPerm('manage_team', 'project'), projectController.createDepartment);
router.delete('/:id/departments/:departmentId', checkPerm('manage_team', 'project'), projectController.deleteDepartment);
router.get('/:id/members', checkPerm('read:team', 'project'), projectController.listMembers);
router.get('/:id/available-people', checkPerm('manage_team', 'project'), projectController.listAvailablePeople);
router.put('/:id/members/:userId', checkPerm('manage_team', 'project'), projectController.assignMember);
router.delete('/:id/members/:userId', checkPerm('manage_team', 'project'), projectController.removeMember);
router.get('/:id/timeline', checkPerm('read:task', 'project'), projectController.getProjectTimeline);
router.get('/:id/attention', checkPerm('read:task', 'project'), projectController.getAttention);
router.get('/:id', checkPerm('read:project', 'project'), projectController.getProjectById);
router.patch('/:id', checkPerm('update:project', 'project'), projectController.updateProject);
router.delete('/:id', checkPerm('delete:project', 'project'), projectController.deleteProject);
router.use('/:projectId/tasks', taskRouter);

module.exports = router;