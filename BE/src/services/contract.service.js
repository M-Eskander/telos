const knex = require('../config/knex');
const contractStorage = require('./contractStorage.service');

function normalizeDates(startDate, endDate) {
  const isDate = value => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!isDate(startDate) || !isDate(endDate)) {
    throw new TypeError('Contract start_date and end_date must be valid YYYY-MM-DD dates');
  }
  if (endDate < startDate) {
    throw new TypeError('Contract end_date must be on or after start_date');
  }
  return { start_date: startDate, end_date: endDate };
}

function publicContract(contract) {
  if (!contract) return null;
  const { storage_key: storageKey, ...metadata } = contract;
  return {
    ...metadata,
    uploaded: Boolean(storageKey),
    file_url: storageKey ? `/api/admin/contracts/${contract.id}/file` : contract.file_url
  };
}

async function insertContract(trx, userId, fileMetadata, dates, terms) {
  const [id] = await trx('contracts').insert({
    user_id: userId,
    file_url: 'pending',
    terms: terms || null,
    start_date: dates.start_date,
    end_date: dates.end_date,
    storage_key: fileMetadata.storageKey,
    original_name: fileMetadata.originalName,
    mime_type: fileMetadata.mimeType,
    file_size: fileMetadata.fileSize
  });
  const fileUrl = `/api/admin/contracts/${id}/file`;
  await trx('contracts').where({ id }).update({ file_url: fileUrl });
  return trx('contracts').where({ id }).first();
}

async function withStoredFile(file, operation) {
  const fileMetadata = await contractStorage.storeContractFile(file);
  try {
    return await operation(fileMetadata);
  } catch (error) {
    try {
      await contractStorage.removeContractFile(fileMetadata.storageKey);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Contract operation failed and its uploaded file could not be removed');
    }
    throw error;
  }
}

async function addContract(userId, file, { start_date: startDate, end_date: endDate, terms }) {
  const dates = normalizeDates(startDate, endDate);
  if (terms !== undefined && terms !== null && typeof terms !== 'string') {
    throw new TypeError('Contract terms must be a string');
  }
  if (!await knex('users').where({ id: userId }).first()) return null;
  return withStoredFile(file, fileMetadata => knex.transaction(async trx => {
    if (!await trx('users').where({ id: userId }).first()) {
      const error = new Error('Person not found');
      error.code = 'PERSON_NOT_FOUND';
      throw error;
    }
    const contract = await insertContract(trx, userId, fileMetadata, dates, terms);
    return publicContract(contract);
  }));
}

async function listContractsForUser(userId, executor = knex) {
  const contracts = await executor('contracts')
    .where({ user_id: userId })
    .orderBy('start_date', 'desc')
    .orderBy('id', 'desc');
  return contracts.map(publicContract);
}

async function getContractFile(contractId) {
  const contract = await knex('contracts').where({ id: contractId }).first();
  if (!contract || !contract.storage_key) return null;
  return {
    file: await contractStorage.readContractFile(contract.storage_key),
    originalName: contract.original_name || 'contract.pdf',
    mimeType: contract.mime_type || 'application/pdf'
  };
}

async function createPersonWithContract(file, metadata, createPerson) {
  const dates = normalizeDates(metadata.start_date, metadata.end_date);
  if (metadata.terms !== undefined && metadata.terms !== null &&
      typeof metadata.terms !== 'string') {
    throw new TypeError('Contract terms must be a string');
  }
  return withStoredFile(file, fileMetadata => knex.transaction(async trx => {
    const user = await createPerson(trx);
    const contract = await insertContract(trx, user.id, fileMetadata, dates, metadata.terms);
    return { user, contract: publicContract(contract) };
  }));
}

module.exports = {
  addContract,
  listContractsForUser,
  getContractFile,
  createPersonWithContract,
  publicContract
};
