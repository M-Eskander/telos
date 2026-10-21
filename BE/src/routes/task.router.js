const express = require('express');
const router = express.Router({ mergeParams: true });
const taskController = require('../controllers/task.controller');
const { checkPerm } = require('../middleware/auth.middleware');

// List tasks or create a new task in a project
router.route('/')
  .get(checkPerm('read:task', 'project', 'projectId'), taskController.getAllForProject)
  .post(checkPerm('create:task', 'project', 'projectId'), taskController.create);

// Move, bulk edit and dependencies are registered before the /:id route.
router.route('/bulk')
  .patch(checkPerm('update:task', 'project', 'projectId'), taskController.bulk);
router.route('/:id/move')
  .patch(checkPerm('update:task', 'project', 'projectId'), taskController.move);
router.route('/:id/dependencies')
  .put(checkPerm('update:task', 'project', 'projectId'), taskController.setDependencies);

// Update or delete a specific task
router.route('/:id')
  .patch(checkPerm('update:task', 'project', 'projectId'), taskController.update)
  .delete(checkPerm('delete:task', 'project', 'projectId'), taskController.remove);

module.exports = router;