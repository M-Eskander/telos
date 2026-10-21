const express = require('express');
const { taskRules, accessPresets } = require('../config/taskRules');

const router = express.Router();

// The task derivation rules, so clients preview the same priority and status
// the server will calculate. The rules change rarely, so the response is
// cached for a short while.
router.get('/task-rules', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ ok: true, rules: taskRules() });
});

// The access levels a role can be created with, so the labels and
// descriptions have a single home on the server.
router.get('/access-presets', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ ok: true, ...accessPresets() });
});

module.exports = router;
