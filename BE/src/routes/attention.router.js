const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const { requireAuthenticated } = require('../middleware/auth.middleware');

// What needs this person, across every project they can see. It sits outside
// the project routes because it is a personal view, not a project's.
router.get('/', requireAuthenticated, projectController.getGlobalAttention);

module.exports = router;
