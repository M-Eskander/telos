const XLSX = require('xlsx');
const knex = require('../config/knex');

// A project sheet is a grid of cells. Every cell keeps the value it holds and
// the formula it came from, so nothing the spreadsheet knew is lost when the
// file travels through the app.
const MAX_ROWS = 400;
const MAX_COLUMNS = 60;
const MAX_CELL_LENGTH = 2000;

const cellValue = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length > MAX_CELL_LENGTH ? text.slice(0, MAX_CELL_LENGTH) : text;
};

function readSheet(sheet) {
  const reference = sheet['!ref'] || 'A1';
  const range = XLSX.utils.decode_range(reference);
  const rows = [];
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
  const lastColumn = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);
  for (let r = range.s.r; r <= lastRow; r += 1) {
    const row = [];
    for (let c = range.s.c; c <= lastColumn; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address];
      if (!cell) {
        row.push(null);
        continue;
      }
      const value = cellValue(cell.v);
      const formula = cell.f ? String(cell.f).slice(0, MAX_CELL_LENGTH) : null;
      row.push(formula ? { v: value, f: formula } : { v: value, f: null });
    }
    rows.push(row);
  }
  // A spreadsheet often carries a hundred empty rows for formatting. Keep
  // only what holds something.
  while (rows.length && rows[rows.length - 1].every((cell) => cell === null || (cell && cell.v === null && !cell.f))) {
    rows.pop();
  }
  const width = rows.reduce((widest, row) => {
    let last = -1;
    for (let index = row.length - 1; index >= 0; index -= 1) {
      const cell = row[index];
      if (cell !== null && cell !== undefined && !(cell.v === null && !cell.f)) {
        last = index;
        break;
      }
    }
    return Math.max(widest, last);
  }, -1);
  return rows.map((row) => row.slice(0, width + 1));
}

// Turn an uploaded workbook into the sheets the app stores.
function parseWorkbook(buffer, fileName) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: true });
  } catch (error) {
    throw new TypeError('That file could not be read as a spreadsheet');
  }
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new TypeError('That spreadsheet has no sheets');
  }
  return workbook.SheetNames.map((name, position) => ({
    name: String(name).slice(0, 120),
    position,
    data: readSheet(workbook.Sheets[name]),
    source: 'upload',
    source_name: fileName ? String(fileName).slice(0, 255) : null
  }));
}

// The other direction: give the sheet back as a workbook they can open.
function buildWorkbook(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const rows = (sheet.data || []).map((row) => (row || []).map((cell) => {
      if (cell === null || cell === undefined) return null;
      if (typeof cell === 'object') {
        if (cell.f) return { t: 's', f: cell.f, v: cell.v === null ? '' : String(cell.v) };
        return cell.v;
      }
      return cell;
    }));
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, (sheet.name || 'Sheet').slice(0, 31));
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

// --- the contract data --------------------------------------------------
// The studio's script reads the Team sheet for hours, roles and department,
// and the Summary sheet for the base revenue share. The app does the same.
const cellText = (cell) => {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object') {
    if (cell.v === null || cell.v === undefined) return '';
    return String(cell.v).trim();
  }
  return String(cell).trim();
};

function findHeaderRow(rows, required) {
  for (let index = 0; index < rows.length; index += 1) {
    const texts = (rows[index] || []).map(cellText);
    if (required.every((name) => texts.includes(name))) return { index, texts };
  }
  return null;
}

function columnIndex(texts, name) {
  const exact = texts.indexOf(name);
  if (exact !== -1) return exact;
  const lower = name.toLowerCase();
  return texts.findIndex((text) => text.toLowerCase() === lower);
}

function parsePercent(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value * 100;
  const text = String(value).trim();
  if (text.endsWith('%')) return parseFloat(text.slice(0, -1)) || 0;
  const number = parseFloat(text);
  if (Number.isNaN(number)) return 0;
  // A bare number above 1 is already a percentage.
  return number > 1 ? number : number * 100;
}

// People straight out of the project sheet, ready to be put on a contract.
function peopleFromSheets(sheets) {
  const team = sheets.find((sheet) => String(sheet.name).trim().toLowerCase() === 'team');
  const summary = sheets.find((sheet) => String(sheet.name).trim().toLowerCase() === 'summary');
  if (!team) throw new TypeError('The spreadsheet needs a sheet named "Team"');
  const teamHeader = findHeaderRow(team.data || [], ['Name', 'Weekly Hours']);
  if (!teamHeader) throw new TypeError('The "Team" sheet needs "Name" and "Weekly Hours" columns');

  const nameColumn = columnIndex(teamHeader.texts, 'Name');
  const departmentColumn = columnIndex(teamHeader.texts, 'Department');
  const roleColumn = columnIndex(teamHeader.texts, 'Role');
  const hoursColumn = columnIndex(teamHeader.texts, 'Weekly Hours');

  const members = new Map();
  for (let index = teamHeader.index + 1; index < (team.data || []).length; index += 1) {
    const row = team.data[index] || [];
    const name = cellText(row[nameColumn]);
    if (!name || name.toUpperCase() === 'TOTAL') continue;
    const hours = parseFloat(cellText(row[hoursColumn])) || 0;
    const role = roleColumn === -1 ? '' : cellText(row[roleColumn]);
    const department = departmentColumn === -1 ? '' : cellText(row[departmentColumn]);
    if (!members.has(name)) {
      members.set(name, {
        name,
        department,
        roles: role ? [role] : [],
        hours,
        share: 0
      });
    } else {
      const member = members.get(name);
      if (role && !member.roles.includes(role)) member.roles.push(role);
      member.hours += hours;
    }
  }

  if (summary) {
    const summaryHeader = findHeaderRow(summary.data || [], ['Name', 'Base Revenue Share %']);
    if (summaryHeader) {
      const nameColumnIndex = columnIndex(summaryHeader.texts, 'Name');
      const shareColumnIndex = columnIndex(summaryHeader.texts, 'Base Revenue Share %');
      for (let index = summaryHeader.index + 1; index < (summary.data || []).length; index += 1) {
        const row = summary.data[index] || [];
        const name = cellText(row[nameColumnIndex]);
        if (!name) continue;
        const member = members.get(name);
        if (!member) continue;
        member.share += parsePercent(row[shareColumnIndex] === undefined || row[shareColumnIndex] === null
          ? null
          : (typeof row[shareColumnIndex] === 'object' ? row[shareColumnIndex].v : row[shareColumnIndex]));
      }
    }
  }

  return {
    people: [...members.values()]
      .filter((member) => member.hours > 0)
      .map((member) => ({
        name: member.name,
        department: member.department,
        role: member.roles.join(' & '),
        hours: member.hours,
        share: `${member.share.toFixed(2)}%`
      })),
    // People the sheet knows about but who have no hours yet: no contract is
    // made for them, and the studio is told why.
    waiting: [...members.values()]
      .filter((member) => member.hours <= 0)
      .map((member) => ({ name: member.name, hours: member.hours }))
  };
}

async function listSheets(projectId) {
  const rows = await knex('project_sheets')
    .where({ project_id: projectId })
    .orderBy('position', 'asc')
    .orderBy('id', 'asc');
  return rows.map((row) => ({
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    position: row.position,
    source: row.source,
    source_name: row.source_name,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    updated_at: row.updated_at
  }));
}

async function replaceSheets(projectId, sheets) {
  await knex.transaction(async (trx) => {
    await trx('project_sheets').where({ project_id: projectId }).del();
    for (let index = 0; index < sheets.length; index += 1) {
      const sheet = sheets[index];
      await trx('project_sheets').insert({
        project_id: projectId,
        name: sheet.name,
        position: index,
        data: JSON.stringify(sheet.data || []),
        source: sheet.source || 'manual',
        source_name: sheet.source_name || null
      });
    }
  });
  return listSheets(projectId);
}

async function saveSheet(projectId, sheetId, { name, data }) {
  const id = Number(sheetId);
  const sheet = await knex('project_sheets').where({ id, project_id: projectId }).first();
  if (!sheet) return null;
  await knex('project_sheets').where({ id }).update({
    name: name ? String(name).slice(0, 120) : sheet.name,
    data: JSON.stringify(data || []),
    source: 'manual',
    updated_at: knex.fn.now()
  });
  const sheets = await listSheets(projectId);
  return sheets.find((entry) => entry.id === id) || null;
}

async function deleteSheet(projectId, sheetId) {
  const removed = await knex('project_sheets').where({ id: Number(sheetId), project_id: projectId }).del();
  return removed > 0;
}

module.exports = {
  parseWorkbook,
  buildWorkbook,
  peopleFromSheets,
  listSheets,
  replaceSheets,
  saveSheet,
  deleteSheet,
  MAX_ROWS,
  MAX_COLUMNS
};
