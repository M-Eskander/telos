const crypto = require('crypto');
const contractStorage = require('./contractStorage.service');
const projectContractService = require('./projectContract.service');
const onlyofficeService = require('./onlyoffice.service');
const tokenService = require('./onlyofficeToken.service');

// The contract layout is edited in the same self-hosted Document Server as the
// workbook, but it is a Word document and a different signed resource. Keeping
// the two services separate means a spreadsheet token can never open or
// replace a project's contract layout.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOWNLOAD_TIMEOUT_MS = 25000;
const MAX_EDITOR_BYTES = contractStorage.MAX_CONTRACT_SIZE;

const { OnlyOfficeError, buildDownloadUrl, callbackPayload } = onlyofficeService;

function backendBaseUrl() {
  return String(process.env.ONLYOFFICE_BACKEND_URL || 'http://backend:5000').replace(/\/+$/, '');
}

function safeDocxName(value, projectId) {
  const name = String(value || '').trim().replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_');
  if (!name.toLowerCase().endsWith('.docx')) return `project-${projectId}-contract.docx`;
  return name.slice(0, 200);
}

function editorKey(projectId, buffer) {
  const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  return `telos-contract-${projectId}-${digest}`;
}

async function readTemplateBuffer(template) {
  try {
    const buffer = await contractStorage.readContractFile(template.docx_key);
    if (!contractStorage.isDocx(buffer)) {
      throw new OnlyOfficeError('The Word layout is not a valid .docx file. Upload it again.', 422);
    }
    return buffer;
  } catch (error) {
    if (error instanceof OnlyOfficeError) throw error;
    throw new OnlyOfficeError('The Word layout file could not be found. Upload it again.', 422);
  }
}

async function requireTemplate(projectId) {
  const template = await projectContractService.getTemplate(projectId);
  if (!template.docx_key) {
    throw new OnlyOfficeError('Upload the Word layout for this project before opening the editor.', 422);
  }
  const buffer = await readTemplateBuffer(template);
  return { template, buffer };
}

async function buildEditorConfig(projectId, user) {
  const numericId = Number(projectId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new OnlyOfficeError('That project is not valid', 400);
  }
  if (!process.env.ONLYOFFICE_JWT_SECRET) {
    throw new OnlyOfficeError(
      'The full editor is not configured yet. Set ONLYOFFICE_JWT_SECRET and restart the backend.',
      503
    );
  }

  const { template, buffer } = await requireTemplate(numericId);
  const fileName = safeDocxName(template.original_docx_name, numericId);
  const key = editorKey(numericId, buffer);
  const documentToken = tokenService.issueContractTemplateDocumentToken({
    projectId: numericId,
    key,
    fileName
  });
  const callbackToken = tokenService.issueContractTemplateCallbackToken({
    projectId: numericId,
    key,
    fileName,
    userId: user && user.id ? user.id : null
  });

  const config = {
    document: {
      fileType: 'docx',
      key,
      title: fileName,
      url: `${backendBaseUrl()}/api/onlyoffice/contract-template/document/${encodeURIComponent(documentToken)}`,
      permissions: {
        edit: true,
        download: true,
        print: true,
        review: false,
        comment: false
      }
    },
    // ONLYOFFICE calls the word processor 'word'.
    documentType: 'word',
    editorConfig: {
      callbackUrl: `${backendBaseUrl()}/api/onlyoffice/contract-template/callback/${encodeURIComponent(callbackToken)}`,
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

  config.token = tokenService.sign(config);
  return { config, key, fileName, templateName: template.name };
}

async function getDocument(projectId) {
  const numericId = Number(projectId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new OnlyOfficeError('That project is not valid', 400);
  }
  const { template, buffer } = await requireTemplate(numericId);
  return {
    buffer,
    fileName: safeDocxName(template.original_docx_name, numericId)
  };
}

async function readLimited(response) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_EDITOR_BYTES) {
      throw new OnlyOfficeError('The edited contract layout is larger than 10 MB', 413);
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_EDITOR_BYTES) {
      await reader.cancel().catch(() => {});
      throw new OnlyOfficeError('The edited contract layout is larger than 10 MB', 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadEditedDocx(rawUrl) {
  const url = buildDownloadUrl(rawUrl);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    });
  } catch (error) {
    throw new OnlyOfficeError(`Could not download the edited contract layout: ${error.message}`, 502);
  }
  if (!response.ok) {
    throw new OnlyOfficeError(`The editor returned HTTP ${response.status} for the contract layout`, 502);
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_EDITOR_BYTES) {
    throw new OnlyOfficeError('The edited contract layout is larger than 10 MB', 413);
  }
  const buffer = await readLimited(response);
  if (!contractStorage.isDocx(buffer)) {
    throw new OnlyOfficeError('The editor did not return a .docx file', 422);
  }
  return buffer;
}

// Two callbacks for one project must not replace each other's layout in the
// middle of a save. The later complete file wins, in arrival order.
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
  const numericId = Number(projectId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new OnlyOfficeError('That project is not valid', 400);
  }
  const data = callbackPayload(body, authorization);
  const status = Number(data.status);
  if (status !== 2 && status !== 6) {
    return { saved: false, status };
  }
  if (!data.url) throw new OnlyOfficeError('The editor callback has no file address', 400);

  return serializeSave(numericId, async () => {
    const template = await projectContractService.getTemplate(numericId);
    if (!template.docx_key) {
      throw new OnlyOfficeError('The contract layout was removed while the editor was open.', 422);
    }
    const buffer = await downloadEditedDocx(data.url);
    const fileName = safeDocxName(pathToken.fileName || template.original_docx_name, numericId);
    await projectContractService.saveTemplate(
      numericId,
      { name: template.name, body: template.body },
      null,
      { originalname: fileName, mimetype: DOCX_MIME, buffer }
    );
    return { saved: true, status, fileName };
  });
}

module.exports = {
  DOCX_MIME,
  MAX_EDITOR_BYTES,
  buildEditorConfig,
  getDocument,
  handleCallback
};
