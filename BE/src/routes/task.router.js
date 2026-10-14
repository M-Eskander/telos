const express = require('express');
const router = express.Router({ mergeParams: true });
const taskController = require('../controllers/task.controller');
const { checkPerm } = require('../middleware/auth.middleware');

// List tasks or create a new task in a project
router.route('/')
  .get(checkPerm('read:project', 'project'), taskController.getAllForProject)
  .post(checkPerm('create:task', 'project'), taskController.create);

// Update or delete a specific task
router.route('/:id')
  .patch(checkPerm('update:task', 'project'), taskController.update)
  .delete(checkPerm('delete:task', 'project'), taskController.remove);

module.exports = router;