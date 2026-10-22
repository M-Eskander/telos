const knex = require('../config/knex');

// The file the studio uploaded is kept byte for byte. An export opens it,
// changes only the cells that moved, and gives the same workbook back with its
// own styles, widths, merges, validations and formulas still in place.
const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;

function templateSize(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.length : 0;
}

async function saveWorkbook(projectId, file, transaction = null) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new TypeError('A spreadsheet file is required');
  }
  if (file.buffer.length > MAX_TEMPLATE_BYTES) {
    throw new TypeError('That spreadsheet is larger than 8 MB');
  }
  const db = transaction || knex;
  const payload = {
    file_name: String(file.originalname || 'sheet.xlsx').slice(0, 255),
    mime_type: String(file.mimetype || 'application/octet-stream').slice(0, 120),
    size: templateSize(file.buffer),
    data: file.buffer,
    updated_at: knex.fn.now()
  };
  const existing = await db('project_workbooks').where({ project_id: projectId }).first();
  if (existing) {
    await db('project_workbooks').where({ id: existing.id }).update(payload);
    return { id: existing.id, fileName: payload.file_name, size: payload.size };
  }
  const inserted = await db('project_workbooks').insert({ project_id: projectId, ...payload });
  return { id: Array.isArray(inserted) ? inserted[0] : inserted, fileName: payload.file_name, size: payload.size };
}

async function getWorkbook(projectId) {
  const row = await knex('project_workbooks').where({ project_id: projectId }).first();
  if (!row) return null;
  const data = row.data;
  const buffer = Buffer.isBuffer(data)
    ? data
    : data instanceof Uint8Array
      ? Buffer.from(data)
      : Buffer.from(String(data || ''), 'binary');
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    buffer
  };
}

async function removeWorkbook(projectId) {
  return knex('project_workbooks').where({ project_id: projectId }).del();
}

module.exports = {
  MAX_TEMPLATE_BYTES,
  saveWorkbook,
  getWorkbook,
  removeWorkbook
};
