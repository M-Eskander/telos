const crypto = require('crypto');
const net = require('net');
const knex = require('../config/knex');
const sheetService = require('./sheet.service');
const studioService = require('./studio.service');
const projectWorkbookService = require('./projectWorkbook.service');
const tokenService = require('./onlyofficeToken.service');

// The full editor is a second door onto the same workbook. ONLYOFFICE renders
// and edits the original .xlsx; its callback hands the saved file back here,
// where it becomes the new original and the cells are recalculated so the
// contracts and the quick grid see the same numbers.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOWNLOAD_TIMEOUT_MS = 25000;
const MAX_EDITOR_BYTES = projectWorkbookService.MAX_TEMPLATE_BYTES;

class OnlyOfficeError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'OnlyOfficeError';
    this.status = status;
  }
}

function internalBaseUrl() {
  return String(process.env.ONLYOFFICE_INTERNAL_URL || 'http://onlyoffice').replace(/\/+$/, '');
}

function backendBaseUrl() {
  return String(process.env.ONLYOFFICE_BACKEND_URL || 'http://backend:5000').replace(/\/+$/, '');
}

function appHostName() {
  try {
    return new URL(process.env.APP_BASE_URL || '').hostname || null;
  } catch {
    return null;
  }
}

function safeXlsxName(value, projectId) {
  const name = String(value || '').trim().replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_');
  if (!name.toLowerCase().endsWith('.xlsx')) return `project-${projectId}-sheet.xlsx`;
  return name.slice(0, 200);
}

function editorKey(projectId, buffer) {
  const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  return `telos-${projectId}-${digest}`;
}

// The Document Server returns a URL on itself (or on the public host Caddy
// exposes). Fetch the file from its internal name so the save never depends on
// the tunnel, and refuse anything that is not a cache/document URL on a host we
// put there ourselves.
function buildDownloadUrl(rawUrl) {
  const internal = new URL(internalBaseUrl());
  let source;
  try {
    source = new URL(String(rawUrl || ''), internal);
  } catch {
    throw new OnlyOfficeError('The editor returned an invalid file address', 400);
  }
  if (source.protocol !== 'http:' && source.protocol !== 'https:') {
    throw new OnlyOfficeError('The editor returned an invalid file address', 400);
  }
  const allowed = new Set([internal.hostname]);
  const publicHost = appHostName();
  if (publicHost) allowed.add(publicHost);
  const path = `${source.pathname}${source.search}`;
  if (!/^\/(?:cache|doc)\//.test(source.pathname)) {
    throw new OnlyOfficeError('The editor returned a file from an unexpected path', 400);
  }
  if (allowed.has(source.hostname)) {
    return new URL(path, internal).toString();
  }
  // A Document Server behind a reverse proxy can name itself with its
  // container IP instead of the Host header. Never fetch that private address
  // directly: ask the app's own public origin for the same cache path, which
  // Caddy already routes to the Document Server. A hostname (as opposed to an
  // IP literal) is still rejected outright.
  const publicBase = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL) : null;
  if (publicBase && net.isIP(source.hostname)) {
    return new URL(path, publicBase).toString();
  }
  throw new OnlyOfficeError('The editor returned a file from an unexpected address', 400);
}

async function readLimited(response, limit) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) throw new OnlyOfficeError('The edited workbook is larger than 8 MB', 413);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new OnlyOfficeError('The edited workbook is larger than 8 MB', 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadEditedFile(rawUrl) {
  const url = buildDownloadUrl(rawUrl);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    });
  } catch (error) {
    throw new OnlyOfficeError(`Could not download the edited workbook: ${error.message}`, 502);
  }
  if (!response.ok) {
    throw new OnlyOfficeError(`The editor returned HTTP ${response.status} for the edited workbook`, 502);
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_EDITOR_BYTES) {
    throw new OnlyOfficeError('The edited workbook is larger than 8 MB', 413);
  }
  const buffer = await readLimited(response, MAX_EDITOR_BYTES);
  if (buffer.length < 2 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new OnlyOfficeError('The editor did not return an .xlsx file', 422);
  }
  return buffer;
}

// Status 2 means "changes are ready to save", status 6 is a forced save when
// the last editor closes. Other statuses only need an acknowledgement.
function callbackPayload(body, authorization) {
  const header = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  const token = (body && typeof body.token === 'string' && body.token) || header;
  if (!token) throw new tokenService.TokenError('A signed editor callback is required');
  const signed = tokenService.verify(token);
  const data = signed && typeof signed.payload === 'object' && signed.payload !== null
    ? signed.payload
    : signed;
  if (!data || typeof data !== 'object' || data.status === undefined) {
    throw new tokenService.TokenError('That editor callback is not valid');
  }
  return data;
}

async function saveEditedFile(projectId, buffer, fileName) {
  if (buffer.length === 0) throw new OnlyOfficeError('The editor returned an empty workbook', 422);
  const parsed = sheetService.parseWorkbook(buffer, fileName);
  if (!parsed.sheets || parsed.sheets.length === 0) {
    throw new OnlyOfficeError('The edited workbook has no sheets', 422);
  }
  await knex.transaction(async (trx) => {
    await sheetService.replaceSheets(projectId, parsed.sheets, trx);
    await projectWorkbookService.saveWorkbook(projectId, {
      originalname: fileName,
      mimetype: XLSX_MIME,
      buffer
    }, trx);
  });
  return { sheets: parsed.sheets.length, warnings: parsed.warnings };
}

// Two callbacks for one project must not replace each other's rows in the
// middle of a transaction. The later file wins, in arrival order.
const saveChains = new Map();
function serializeSave(projectId, task) {
  const key = String(projectId);
  const previous = saveChains.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  saveChains.set(key, run);
  const cleanup = () => {
    if (saveChains.get(key) === run) saveChains.delete(key);
  };
  run.then(cleanup, cleanup);
  return run;
}

async function handleCallback(projectId, body, pathToken, authorization) {
  if (!Number.isInteger(Number(projectId)) || Number(projectId) <= 0) {
    throw new OnlyOfficeError('That project is not valid', 400);
  }
  const data = callbackPayload(body, authorization);
  const status = Number(data.status);
  if (status !== 2 && status !== 6) {
    return { saved: false, status };
  }
  if (!data.url) throw new OnlyOfficeError('The editor callback has no file address', 400);
  const fileName = safeXlsxName(pathToken.fileName, projectId);
  return serializeSave(projectId, async () => {
    const buffer = await downloadEditedFile(data.url);
    const saved = await saveEditedFile(Number(projectId), buffer, fileName);
    return { saved: true, status, ...saved };
  });
}

async function buildEditorConfig(projectId, user) {
  // Fail before doing any work: without the shared secret the Document Server
  // will not accept the config, and the page should show the fallback instead.
  if (!process.env.ONLYOFFICE_JWT_SECRET) {
    throw new OnlyOfficeError(
      'The full editor is not configured yet. Set ONLYOFFICE_JWT_SECRET and restart the backend.',
      503
    );
  }
  const exported = await studioService.exportSheets(projectId);
  if (!exported || !Buffer.isBuffer(exported.buffer) || exported.buffer.length === 0) {
    throw new OnlyOfficeError('This project has no workbook to open', 422);
  }

  const numericId = Number(projectId);
  const fileName = safeXlsxName(exported.fileName, numericId);
  const key = editorKey(numericId, exported.buffer);
  const documentToken = tokenService.issueDocumentToken({
    projectId: numericId,
    key,
    fileName
  });
  const callbackToken = tokenService.issueCallbackToken({
    projectId: numericId,
    key,
    fileName,
    userId: user && user.id ? user.id : null
  });

  const config = {
    document: {
      fileType: 'xlsx',
      key,
      title: fileName,
      url: `${backendBaseUrl()}/api/onlyoffice/document/${encodeURIComponent(documentToken)}`,
      permissions: {
        edit: true,
        download: true,
        print: true,
        review: false,
        comment: false
      }
    },
    // ONLYOFFICE's API accepts word/cell/slide/pdf/diagram here. 'cell' is
    // its name for the spreadsheet editor; 'spreadsheet' makes the editor
    // iframe load but never initialise, so onAppReady/onDocumentReady never
    // fire.
    documentType: 'cell',
    editorConfig: {
      callbackUrl: `${backendBaseUrl()}/api/onlyoffice/callback/${encodeURIComponent(callbackToken)}`,
      lang: 'en',
      mode: 'edit',
      user: {
        id: String(user && user.id ? user.id : 'telos'),
        name: String((user && (user.name || user.email)) || 'Telos')
      },
      customization: {
        autosave: true,
        forcesave: true,
        compactHeader: false,
        toolbarNoTabs: false,
        help: false,
        hideRightMenu: true,
        about: true
      }
    },
    height: '100%',
    width: '100%',
    type: 'desktop'
  };

  // The Document Server verifies this token and then uses its payload as the
  // editor config. The token is added after signing, so it signs exactly the
  // object above.
  config.token = tokenService.sign(config);
  return { config, key, fileName };
}

async function getDocument(projectId) {
  const exported = await studioService.exportSheets(projectId);
  if (!exported || !Buffer.isBuffer(exported.buffer) || exported.buffer.length === 0) {
    throw new OnlyOfficeError('This project has no workbook to open', 422);
  }
  return {
    buffer: exported.buffer,
    fileName: safeXlsxName(exported.fileName, projectId)
  };
}

module.exports = {
  OnlyOfficeError,
  XLSX_MIME,
  MAX_EDITOR_BYTES,
  buildEditorConfig,
  getDocument,
  handleCallback,
  buildDownloadUrl,
  callbackPayload,
  editorKey,
  safeXlsxName
};
