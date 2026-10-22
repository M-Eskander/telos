const studioService = require('../services/studio.service');

function fail(res, error) {
  if (error instanceof TypeError) {
    return res.status(400).json({ ok: false, message: error.message });
  }
  if (error && error.code === 'NOT_FOUND') {
    return res.status(404).json({ ok: false, message: error.message });
  }
  console.error(error);
  return res.status(500).json({ ok: false, message: 'Something went wrong' });
}

// --- the spreadsheet -----------------------------------------------------
exports.listSheets = async (req, res, next) => {
  try {
    return res.json({ ok: true, sheets: await studioService.listSheets(req.params.id) });
  } catch (error) {
    return next(error);
  }
};

exports.importSheet = async (req, res, next) => {
  try {
    const sheets = await studioService.importSheet(req.params.id, req.file);
    return res.status(201).json({ ok: true, sheets });
  } catch (error) {
    return fail(res, error);
  }
};

exports.saveSheet = async (req, res, next) => {
  try {
    const sheet = await studioService.saveSheet(req.params.id, req.params.sheetId, req.body || {});
    if (!sheet) return res.status(404).json({ ok: false, message: 'Sheet not found' });
    return res.json({ ok: true, sheet });
  } catch (error) {
    return fail(res, error);
  }
};

exports.deleteSheet = async (req, res, next) => {
  try {
    const removed = await studioService.deleteSheet(req.params.id, req.params.sheetId);
    if (!removed) return res.status(404).json({ ok: false, message: 'Sheet not found' });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

exports.exportSheets = async (req, res, next) => {
  try {
    const buffer = await studioService.exportSheets(req.params.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="project-${req.params.id}-sheet.xlsx"`);
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
};

// --- the contract layout and the contracts -------------------------------
exports.getTemplate = async (req, res, next) => {
  try {
    return res.json({ ok: true, template: await studioService.getTemplate(req.params.id) });
  } catch (error) {
    return next(error);
  }
};

exports.saveTemplate = async (req, res, next) => {
  try {
    const template = await studioService.saveTemplate(req.params.id, req.body || {}, req.file);
    return res.json({ ok: true, template });
  } catch (error) {
    return fail(res, error);
  }
};

exports.listContracts = async (req, res, next) => {
  try {
    return res.json({ ok: true, contracts: await studioService.listContracts(req.params.id) });
  } catch (error) {
    return next(error);
  }
};

exports.generateContracts = async (req, res, next) => {
  try {
    const result = await studioService.generateContracts(
      req.params.id,
      req.body || {},
      req.user ? req.user.id : null
    );
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    return fail(res, error);
  }
};

exports.updateContract = async (req, res, next) => {
  try {
    const contract = await studioService.updateContract(req.params.id, req.params.contractId, req.body || {});
    if (!contract) return res.status(404).json({ ok: false, message: 'Contract not found' });
    return res.json({ ok: true, contract });
  } catch (error) {
    return fail(res, error);
  }
};

exports.deleteContract = async (req, res, next) => {
  try {
    const removed = await studioService.deleteContract(req.params.id, req.params.contractId);
    if (!removed) return res.status(404).json({ ok: false, message: 'Contract not found' });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

// --- meetings ------------------------------------------------------------
exports.listMeetings = async (req, res, next) => {
  try {
    return res.json({ ok: true, meetings: await studioService.listMeetings(req.params.id) });
  } catch (error) {
    return next(error);
  }
};

exports.createMeeting = async (req, res, next) => {
  try {
    const meeting = await studioService.createMeeting(req.params.id, req.body || {}, req.user ? req.user.id : null);
    return res.status(201).json({ ok: true, meeting });
  } catch (error) {
    return fail(res, error);
  }
};

exports.updateMeeting = async (req, res, next) => {
  try {
    const meeting = await studioService.updateMeeting(req.params.id, req.params.meetingId, req.body || {});
    if (!meeting) return res.status(404).json({ ok: false, message: 'Meeting not found' });
    return res.json({ ok: true, meeting });
  } catch (error) {
    return fail(res, error);
  }
};

exports.deleteMeeting = async (req, res, next) => {
  try {
    const removed = await studioService.deleteMeeting(req.params.id, req.params.meetingId);
    if (!removed) return res.status(404).json({ ok: false, message: 'Meeting not found' });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

// --- who is working on what ----------------------------------------------
exports.projectWork = async (req, res, next) => {
  try {
    const work = await studioService.projectWork(req.params.id, { userId: req.user ? req.user.id : null });
    return res.json({ ok: true, ...work });
  } catch (error) {
    return next(error);
  }
};
