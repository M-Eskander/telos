const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MAX_CONTRACT_SIZE = 10 * 1024 * 1024;
const storageDirectory = () => path.resolve(
  process.env.CONTRACT_STORAGE_DIR || path.join(__dirname, '../../storage/contracts')
);

async function storeContractFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new TypeError('A contract PDF file is required');
  }
  if (file.mimetype !== 'application/pdf' ||
      file.buffer.length < 5 ||
      file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new TypeError('Contract file must be a valid PDF');
  }
  if (file.buffer.length > MAX_CONTRACT_SIZE) {
    throw new TypeError('Contract PDF must not exceed 10 MB');
  }

  const directory = storageDirectory();
  const storageKey = `${crypto.randomUUID()}.pdf`;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(directory, storageKey), file.buffer, { flag: 'wx', mode: 0o600 });

  return {
    storageKey,
    originalName: path.basename(file.originalname || 'contract.pdf').slice(0, 255),
    mimeType: 'application/pdf',
    fileSize: file.buffer.length
  };
}

async function removeContractFile(storageKey) {
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(storageKey)) {
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
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(storageKey)) {
    throw new TypeError('Invalid stored contract key');
  }
  return fs.readFile(path.join(storageDirectory(), storageKey));
}

module.exports = {
  MAX_CONTRACT_SIZE,
  storeContractFile,
  removeContractFile,
  readContractFile
};
