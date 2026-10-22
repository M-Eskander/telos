const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MAX_CONTRACT_SIZE = 10 * 1024 * 1024;
const storageDirectory = () => path.resolve(
  process.env.CONTRACT_STORAGE_DIR || path.join(__dirname, '../../storage/contracts')
);

const KEY_PATTERN = /^[0-9a-f-]{36}\.(pdf|docx)$/i;

function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 &&
    buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

// A Word file is a zip. The check is cheap and catches the wrong file early.
function isDocx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) return false;
  const head = buffer.subarray(0, 4).toString('hex');
  // "PK\x03\x04" for a normal zip, "PK\x05\x06" for an empty one.
  if (head !== '504b0304' && head !== '504b0506') return false;
  return buffer.includes(Buffer.from('word/document.xml', 'utf8'));
}

async function writeFile(storageKey, buffer) {
  const directory = storageDirectory();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(directory, storageKey), buffer, { flag: 'wx', mode: 0o600 });
  return {
    storageKey,
    originalName: path.basename(storageKey).slice(0, 255),
    mimeType: storageKey.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/pdf',
    fileSize: buffer.length
  };
}

async function storeContractFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new TypeError('A contract PDF file is required');
  }
  if (file.mimetype !== 'application/pdf' || !isPdf(file.buffer)) {
    throw new TypeError('Contract file must be a valid PDF');
  }
  if (file.buffer.length > MAX_CONTRACT_SIZE) {
    throw new TypeError('Contract PDF must not exceed 10 MB');
  }
  const storageKey = `${crypto.randomUUID()}.pdf`;
  const metadata = await writeFile(storageKey, file.buffer);
  return { ...metadata, originalName: path.basename(file.originalname || 'contract.pdf').slice(0, 255) };
}

// The layout of a project: a Word file with the placeholders in it.
async function storeTemplateFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new TypeError('A contract layout file is required');
  }
  if (file.buffer.length > MAX_CONTRACT_SIZE) {
    throw new TypeError('The layout must not exceed 10 MB');
  }
  if (!isDocx(file.buffer)) {
    throw new TypeError('The layout must be a Word file (.docx)');
  }
  const storageKey = `${crypto.randomUUID()}.docx`;
  const metadata = await writeFile(storageKey, file.buffer);
  return { ...metadata, originalName: path.basename(file.originalname || 'layout.docx').slice(0, 255) };
}

// A file the app made itself: the filled Word file, the PDF of it.
async function storeGeneratedFile(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new TypeError('Nothing to store');
  }
  const ext = extension === 'docx' ? 'docx' : 'pdf';
  const storageKey = `${crypto.randomUUID()}.${ext}`;
  return writeFile(storageKey, buffer);
}

async function removeContractFile(storageKey) {
  if (!KEY_PATTERN.test(storageKey)) {
    throw new TypeError('Invalid stored contract key');
  }
  const target = path.join(storageDirectory(), storageKey);
  try {
    await fs.unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function readContractFile(storageKey) {
  if (!KEY_PATTERN.test(storageKey)) {
    throw new TypeError('Invalid stored contract key');
  }
  return fs.readFile(path.join(storageDirectory(), storageKey));
}

module.exports = {
  MAX_CONTRACT_SIZE,
  storeContractFile,
  storeTemplateFile,
  storeGeneratedFile,
  removeContractFile,
  readContractFile,
  isPdf,
  isDocx
};
