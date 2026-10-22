const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const studioService = require('../services/studio.service');
const meetingService = require('../services/meeting.service');
const { requireAuthenticated } = require('../middleware/auth.middleware');

const DAY = 86400000;
const isoDate = (value) => new Date(value).toISOString().slice(0, 10);

// Everything waiting for this person, across every project.
router.get('/work', requireAuthenticated, async (req, res, next) => {
  try {
    const tasks = await studioService.myWork(req.user.id);
    const today = isoDate(Date.now());
    const weekEnd = isoDate(Date.now() + 7 * DAY);
    const meetings = await meetingService.listMeetingsForUser(req.user.id, { from: today, to: weekEnd });
    const projects = await knex('project_memberships as m')
      .join('projects as p', 'p.id', 'm.project_id')
      .where('m.user_id', req.user.id)
      .select('p.id', 'p.name', 'p.progress')
      .orderBy('p.name', 'asc');

    const open = tasks.filter((task) => task.status !== 'done');
    res.json({
      ok: true,
      tasks: open,
      overdue: open.filter((task) => task.schedule === 'overdue').length,
      dueSoon: open.filter((task) => task.schedule === 'due_soon').length,
      atRisk: open.filter((task) => task.schedule === 'at_risk').length,
      meetings,
      projects
    });
  } catch (error) {
    next(error);
  }
});

// The meetings of this person: this week first, then what is coming.
router.get('/meetings', requireAuthenticated, async (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : isoDate(Date.now());
    const to = req.query.to ? String(req.query.to) : isoDate(Date.now() + 120 * DAY);
    const mine = await meetingService.listMeetingsForUser(req.user.id, { from, to });
    const all = await meetingService.listAllMeetings({ from, to });
    res.json({ ok: true, meetings: mine, all });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
