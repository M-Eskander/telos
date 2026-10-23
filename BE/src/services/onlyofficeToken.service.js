const crypto = require('crypto');

// ONLYOFFICE signs the editor config and its own callbacks with HS256. The
// studio already has Node's crypto, so the editor does not need another JWT
// package just to put a signature on ten small JSON objects.
const HEADER = { alg: 'HS256', typ: 'JWT' };
const CLOCK_SKEW_SECONDS = 60;

class TokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenError';
    this.status = 401;
  }
}

function secret() {
  const value = process.env.ONLYOFFICE_JWT_SECRET;
  if (!value) {
    const error = new Error('The full editor is not configured yet. Set ONLYOFFICE_JWT_SECRET and restart the backend.');
    error.status = 503;
    error.code = 'ONLYOFFICE_NOT_CONFIGURED';
    throw error;
  }
  return value;
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value) => JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));

function sign(payload) {
  const header = encode(HEADER);
  const body = encode(payload);
  const data = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret()).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verify(token) {
  if (typeof token !== 'string') throw new TokenError('A signed token is required');
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('That token is not valid');

  const [header, body, signature] = parts;
  let parsedHeader;
  let payload;
  try {
    parsedHeader = decode(header);
    payload = decode(body);
  } catch {
    throw new TokenError('That token is not valid');
  }
  if (!parsedHeader || parsedHeader.alg !== 'HS256') {
    throw new TokenError('That token is not valid');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TokenError('That token is not valid');
  }

  const expected = crypto.createHmac('sha256', secret()).update(`${header}.${body}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new TokenError('That token is not valid');
  }

  if (typeof payload.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now - CLOCK_SKEW_SECONDS) throw new TokenError('That editor session has expired');
  }
  return payload;
}

function issue(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ ...payload, iat: now, exp: now + ttlSeconds });
}

function issueDocumentToken({ projectId, key, fileName, ttlSeconds = 12 * 3600 }) {
  return issue({ purpose: 'document', projectId, key, fileName }, ttlSeconds);
}

function issueCallbackToken({ projectId, key, fileName, userId = null, ttlSeconds = 7 * 24 * 3600 }) {
  return issue({ purpose: 'callback', projectId, key, fileName, userId }, ttlSeconds);
}

// The contract layout is a separate document from the workbook. Keep its
// tokens on their own purposes so a workbook link can never open or replace a
// project's Word contract.
function issueContractTemplateDocumentToken({ projectId, key, fileName, ttlSeconds = 12 * 3600 }) {
  return issue({ purpose: 'contract-template-document', projectId, key, fileName }, ttlSeconds);
}

function issueContractTemplateCallbackToken({ projectId, key, fileName, userId = null, ttlSeconds = 7 * 24 * 3600 }) {
  return issue({ purpose: 'contract-template-callback', projectId, key, fileName, userId }, ttlSeconds);
}

module.exports = {
  TokenError,
  sign,
  verify,
  issueDocumentToken,
  issueCallbackToken,
  issueContractTemplateDocumentToken,
  issueContractTemplateCallbackToken
};
