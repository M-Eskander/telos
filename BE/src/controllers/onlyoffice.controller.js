const onlyofficeService = require('../services/onlyoffice.service');
const tokenService = require('../services/onlyofficeToken.service');

function statusOf(error) {
  return Number(error && error.status) || 500;
}

exports.config = async (req, res, next) => {
  try {
    const result = await onlyofficeService.buildEditorConfig(req.params.id, req.user);
    return res.json({
      ok: true,
      config: result.config,
      projectName: req.project ? req.project.name : null
    });
  } catch (error) {
    if (error && error.status) {
      return res.status(error.status).json({ ok: false, message: error.message });
    }
    return next(error);
  }
};

exports.document = async (req, res) => {
  try {
    const token = tokenService.verify(req.params.token);
    if (token.purpose !== 'document') {
      return res.status(401).json({ ok: false, message: 'That document link is not valid' });
    }
    const projectId = Number(token.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(401).json({ ok: false, message: 'That document link is not valid' });
    }
    const document = await onlyofficeService.getDocument(projectId);
    // Node headers are latin-1; keep a Unicode source name out of the header
    // while leaving the real name in the document config and the stored file.
    const headerName = document.fileName.replace(/[^\x20-\x7e]/g, '_');
    res.setHeader('Content-Type', onlyofficeService.XLSX_MIME);
    res.setHeader('Content-Disposition', `inline; filename="${headerName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(document.buffer);
  } catch (error) {
    const status = statusOf(error);
    if (status !== 401) console.error('[onlyoffice] could not serve the document:', error.message);
    return res.status(status).json({ ok: false, message: status === 401 ? 'That document link is not valid' : 'Could not open the workbook' });
  }
};

exports.callback = async (req, res) => {
  try {
    const pathToken = tokenService.verify(req.params.token);
    if (pathToken.purpose !== 'callback') {
      return res.status(401).json({ error: 1 });
    }
    const projectId = Number(pathToken.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(401).json({ error: 1 });
    }
    const result = await onlyofficeService.handleCallback(
      projectId,
      req.body || {},
      pathToken,
      req.get('authorization')
    );
    if (result.saved) {
      console.log(`[onlyoffice] saved project ${projectId}: ${result.sheets} sheets, ${result.warnings.length} warning(s)`);
    }
    return res.json({ error: 0 });
  } catch (error) {
    const status = statusOf(error);
    console.error('[onlyoffice] callback failed:', error.message);
    return res.status(status).json({ error: 1 });
  }
};
