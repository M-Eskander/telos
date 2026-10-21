const express = require('express');
const { taskRules } = require('../config/taskRules');

const router = express.Router();

// The task derivation rules, so clients preview the same priority and status
// the server will calculate. The rules change rarely, so the response is
// cached for a short while.
router.get('/task-rules', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ ok: true, rules: taskRules() });
});

module.exports = router;
