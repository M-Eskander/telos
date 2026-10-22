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
    const imported = await studioService.importSheet(req.params.id, req.file);
    return res.status(201).json({ ok: true, sheets: imported.sheets, warnings: imported.warnings });
  } catch (error) {
    return fail(res, error);
  }
};

exports.saveSheet = async (req, res, next) => {
  try {
    const saved = await studioService.saveSheet(req.params.id, req.params.sheetId, req.body || {});
    if (!saved || !saved.sheet) return res.status(404).json({ ok: false, message: 'Sheet not found' });
    // Every sheet comes back too: editing one cell can move numbers on the
    // other sheets, and the app shows the new answers straight away.
    return res.json({ ok: true, sheet: saved.sheet, sheets: saved.sheets });
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
    const exported = await studioService.exportSheets(req.params.id);
    const fileName = String(exported.fileName || `project-${req.params.id}-sheet.xlsx`)
      .replace(/[^\w.\- ()]/g, '_')
      .slice(0, 120) || `project-${req.params.id}-sheet.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(exported.buffer);
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
    const files = req.files || {};
    const layout = files.layout && files.layout[0] ? files.layout[0] : null;
    const pdf = files.contract && files.contract[0] ? files.contract[0] : null;
    const docxFile = layout && String(layout.originalname || '').toLowerCase().endsWith('.docx') ? layout : null;
    const pdfFile = pdf || (layout && !docxFile ? layout : null);
    const template = await studioService.saveTemplate(req.params.id, req.body || {}, pdfFile, docxFile);
    return res.json({ ok: true, template });
  } catch (error) {
    return fail(res, error);
  }
};

exports.getContractFile = async (req, res, next) => {
  try {
    const kind = req.params.kind === 'word' ? 'word' : 'pdf';
    const file = await studioService.getContractFile(req.params.id, req.params.contractId, kind);
    if (!file) return res.status(404).json({ ok: false, message: 'That file has not been made yet' });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return res.send(file.buffer);
  } catch (error) {
    return next(error);
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
