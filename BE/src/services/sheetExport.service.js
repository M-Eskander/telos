const XLSX = require('xlsx');
const { unzipSync, zipSync, strToU8, strFromU8 } = require('fflate');

// Exporting a project sheet must not redraw the studio's workbook. The client
// uploads a designed .xlsx once; this module opens that exact file, replaces
// only the cells whose value or formula moved, and leaves every other part of
// the package alone: styles, number formats, column widths, row heights,
// merges, data-validation dropdowns, conditional formatting and shared
// formulas. Everything outside <sheetData> is byte-for-byte the original.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ERROR_VALUE = /^#(?:DIV\/0!|N\/A|VALUE!|NAME\?|REF!|NUM!|NULL!|CIRC!|SPILL!|CALC!|GETTING_DATA)$/;

const decodeXml = (text) => String(text).replace(/&(amp|lt|gt|quot|apos);/g, (match, entity) => ({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
}[entity]));

const escapeXml = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const attribute = (tag, name) => {
  if (!tag) return null;
  const match = String(tag).match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
};

const elements = (xml, name) => {
  const pattern = new RegExp(`<${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</${name}>)`, 'g');
  const found = [];
  let match;
  while ((match = pattern.exec(String(xml || ''))) !== null) found.push(match[0]);
  return found;
};

const isEmpty = (value) => value === null || value === undefined || value === '';

const isDateFormat = (cell) => cell?.t === 'd' || /[ymd]/i.test(String(cell?.z || ''));

const excelSerial = (iso) => {
  const [year, month, day] = String(iso).split('-').map(Number);
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
};

const comparableValue = (value, baseCell) => {
  if (typeof value === 'string' && ISO_DATE.test(value) && isDateFormat(baseCell)) {
    return excelSerial(value);
  }
  return value;
};

const nearlyEqual = (a, b) => {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
};

function sameCell(baseCell, current) {
  const baseFormula = baseCell?.f ? String(baseCell.f).trim() : '';
  const currentFormula = current?.f ? String(current.f).trim() : '';
  if (baseFormula !== currentFormula) return false;
  const baseValue = comparableValue(baseCell?.v, baseCell);
  const currentValue = comparableValue(current?.v, baseCell);
  if (isEmpty(baseValue) && isEmpty(currentValue)) return true;
  if (typeof baseValue === 'number' && typeof currentValue === 'number') return nearlyEqual(baseValue, currentValue);
  if (typeof baseValue === 'string' && typeof currentValue === 'string') return baseValue === currentValue;
  if (typeof baseValue === 'boolean' && typeof currentValue === 'boolean') return baseValue === currentValue;
  return false;
}

// A map of sheet name -> worksheet path inside the package, obtained from the
// workbook's own relationship file.
function readSheetPaths(zip) {
  if (!zip['xl/workbook.xml'] || !zip['xl/_rels/workbook.xml.rels']) return { names: [], paths: {} };
  const workbookXml = strFromU8(zip['xl/workbook.xml']);
  const relationships = {};
  for (const tag of elements(strFromU8(zip['xl/_rels/workbook.xml.rels']), 'Relationship')) {
    const id = attribute(tag, 'Id');
    const target = attribute(tag, 'Target');
    if (!id || !target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    relationships[id] = path.replace(/^xl\/\.\.\//, '');
  }
  const names = [];
  const paths = {};
  for (const tag of elements(workbookXml, 'sheet')) {
    const name = attribute(tag, 'name');
    const rel = attribute(tag, 'r:id');
    if (!name || !rel || !relationships[rel]) continue;
    names.push(name);
    paths[name] = relationships[rel];
  }
  return { names, paths, workbookXml };
}

function readRows(sheetXml) {
  const match = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!match) {
    const selfClosing = sheetXml.match(/<sheetData\b([^>]*)\/>/);
    return selfClosing
      ? { start: selfClosing.index + selfClosing[0].length, end: selfClosing.index + selfClosing[0].length, selfClosing: selfClosing[0], rows: [] }
      : null;
  }
  const start = sheetXml.indexOf('>', match.index) + 1;
  const end = start + match[1].length;
  const rows = [];
  const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let inferredRow = 1;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(match[1])) !== null) {
    const attrs = rowMatch[1] || '';
    const inner = rowMatch[2] === undefined ? '' : rowMatch[2];
    const selfClosing = rowMatch[2] === undefined;
    const rowNumber = Number(attribute(attrs, 'r')) || inferredRow;
    inferredRow = rowNumber + 1;
    const cells = [];
    let inferredColumn = 0;
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(inner)) !== null) {
      const cellAttrs = cellMatch[1] || '';
      const cellInner = cellMatch[2] === undefined ? '' : cellMatch[2];
      const address = attribute(cellAttrs, 'r');
      const position = address ? XLSX.utils.decode_cell(address) : { r: rowNumber - 1, c: inferredColumn };
      inferredColumn = position.c + 1;
      cells.push({
        address: XLSX.utils.encode_cell(position),
        attrs: cellAttrs,
        inner: cellInner,
        raw: cellMatch[0],
        style: attribute(cellAttrs, 's'),
        col: position.c
      });
    }
    rows.push({
      r: rowNumber,
      attrs,
      inner,
      raw: rowMatch[0],
      selfClosing,
      cells,
      dirty: false,
      changes: new Map()
    });
  }
  return { start, end, rows, selfClosing: null };
}

function formulaElement(cell) {
  if (!cell?.inner) return null;
  const match = cell.inner.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
  if (!match) return null;
  return {
    raw: match[0],
    attrs: match[1] || '',
    text: match[2] === undefined ? '' : decodeXml(match[2])
  };
}

function buildCell(address, current, baseCell, original, options = {}) {
  const formula = current?.f ? String(current.f).replace(/^=/, '') : '';
  const value = current?.v === undefined ? null : current.v;
  const originalFormula = formulaElement(original);
  const baseFormula = baseCell?.f ? String(baseCell.f).trim() : '';
  const formulaUnchanged = Boolean(formula) && baseFormula && formula.trim() === baseFormula;
  // If SheetJS could not resolve a formula the file does carry, leave the
  // original <f> alone when only the cached value moves.
  const unknownFormula = !formula && !baseFormula && originalFormula && !options.forceNormalFormula;
  const isEmptyCell = !formula && !unknownFormula && isEmpty(value);
  const style = original ? original.style : (options.style ?? null);
  const preserved = [];
  for (const name of ['cm', 'vm']) {
    const attrValue = original ? attribute(original.attrs, name) : null;
    if (attrValue) preserved.push(`${name}="${escapeXml(attrValue)}"`);
  }

  if (isEmptyCell) {
    if (style === null && preserved.length === 0) return null;
    return `<c r="${address}"${style !== null ? ` s="${escapeXml(style)}"` : ''}${preserved.length ? ` ${preserved.join(' ')}` : ''}/>`;
  }

  let formulaXml = '';
  if (formula) {
    if (formulaUnchanged && originalFormula && !options.forceNormalFormula) formulaXml = originalFormula.raw;
    else formulaXml = `<f>${escapeXml(formula)}</f>`;
  } else if (unknownFormula) {
    formulaXml = originalFormula.raw;
  }
  const hasFormula = Boolean(formulaXml);

  let type = '';
  let valueXml = '';
  if (!isEmpty(value)) {
    const dateSerial = typeof value === 'string' && ISO_DATE.test(value)
      && (isDateFormat(baseCell) || isDateFormat(current));
    if (typeof value === 'string' && ERROR_VALUE.test(value.trim())) {
      type = 'e';
      valueXml = `<v>${escapeXml(value)}</v>`;
    } else if (dateSerial) {
      valueXml = `<v>${excelSerial(value)}</v>`;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      valueXml = `<v>${value}</v>`;
    } else if (typeof value === 'boolean') {
      type = 'b';
      valueXml = `<v>${value ? 1 : 0}</v>`;
    } else {
      const text = String(value);
      if (hasFormula) {
        type = 'str';
        valueXml = `<v>${escapeXml(text)}</v>`;
      } else {
        type = 'inlineStr';
        valueXml = `<is><t xml:space="preserve">${escapeXml(text)}</t></is>`;
      }
    }
  }

  const attrs = [`r="${address}"`];
  if (style !== null) attrs.push(`s="${escapeXml(style)}"`);
  if (type) attrs.push(`t="${type}"`);
  if (preserved.length) attrs.push(...preserved);
  if (!formulaXml && !valueXml) return `<c ${attrs.join(' ')}/>`;
  return `<c ${attrs.join(' ')}>${formulaXml}${valueXml}</c>`;
}

function nearestStyle(address, styles) {
  const position = XLSX.utils.decode_cell(address);
  for (let row = position.r - 1; row >= 0; row -= 1) {
    const style = styles.get(XLSX.utils.encode_cell({ r: row, c: position.c }));
    if (style !== null && style !== undefined) return style;
  }
  for (let column = position.c - 1; column >= 0; column -= 1) {
    const style = styles.get(XLSX.utils.encode_cell({ r: position.r, c: column }));
    if (style !== null && style !== undefined) return style;
  }
  if (position.r > 0 && position.c > 0) {
    const style = styles.get(XLSX.utils.encode_cell({ r: position.r - 1, c: position.c - 1 }));
    if (style !== null && style !== undefined) return style;
  }
  return null;
}

function sharedFormulaGroups(cells) {
  const groups = new Map();
  for (const cell of cells) {
    const formula = formulaElement(cell);
    if (!formula) continue;
    if (attribute(formula.attrs, 't') !== 'shared') continue;
    const si = attribute(formula.attrs, 'si');
    if (!si) continue;
    if (!groups.has(si)) groups.set(si, { members: [], master: null });
    groups.get(si).members.push(cell);
    if (attribute(formula.attrs, 'ref')) groups.get(si).master = cell;
  }
  return groups;
}

function updateSpans(attrs, minimum, maximum) {
  if (!maximum && maximum !== 0) return attrs;
  if (!/\bspans="/.test(attrs)) return attrs;
  return attrs.replace(/\bspans="[^"]*"/, `spans="${minimum + 1}:${maximum + 1}"`);
}

function patchSheetXml(sheetXml, baseline, sheet) {
  const parsed = readRows(sheetXml);
  if (!parsed) return { xml: sheetXml, changed: false };
  const data = Array.isArray(sheet.data) ? sheet.data : [];
  const imported = sheet.meta?.imported || {};
  const rowCount = Math.max(data.length, Number(imported.rows) || 0);
  const dataColumns = data.reduce((widest, row) => Math.max(widest, Array.isArray(row) ? row.length : 0), 0);
  const columnCount = Math.max(dataColumns, Number(imported.cols) || 0);

  const cellIndex = new Map();
  const styles = new Map();
  for (const row of parsed.rows) {
    for (const cell of row.cells) {
      cellIndex.set(cell.address, cell);
      if (cell.style !== null) styles.set(cell.address, cell.style);
    }
  }

  const changes = new Map();
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const original = baseline[address];
      const current = data[row]?.[column] || null;
      const baseHolds = original && (original.f || !isEmpty(original.v));
      const currentHolds = current && (current.f || !isEmpty(current.v));
      if (!baseHolds && !currentHolds) continue;
      if (sameCell(original, current)) continue;
      changes.set(address, { current, baseCell: original, original: cellIndex.get(address) || null });
    }
  }

  if (changes.size === 0) return { xml: sheetXml, changed: false };

  // If a shared formula's structure changes, every member is written as a
  // normal formula; a dangling shared reference would corrupt the workbook.
  const groups = sharedFormulaGroups([...cellIndex.values()]);
  for (const group of groups.values()) {
    let structureChanged = false;
    for (const member of group.members) {
      const change = changes.get(member.address);
      if (!change) continue;
      const before = change.baseCell?.f ? String(change.baseCell.f).trim() : '';
      const after = change.current?.f ? String(change.current.f).trim() : '';
      if (before !== after) structureChanged = true;
    }
    if (!structureChanged) continue;
    for (const member of group.members) {
      if (changes.has(member.address)) {
        changes.get(member.address).forceNormalFormula = true;
        continue;
      }
      const position = XLSX.utils.decode_cell(member.address);
      const fromData = data[position.r]?.[position.c] || null;
      const importedRows = Number(imported.rows) || 0;
      const importedColumns = Number(imported.cols) || 0;
      const inImportedWindow = position.r < importedRows && position.c < importedColumns;
      const original = baseline[member.address];
      const current = fromData || (inImportedWindow || !original
        ? fromData
        : { v: original.v, f: original.f, z: original.z });
      changes.set(member.address, {
        current,
        baseCell: original,
        original: member,
        forceNormalFormula: true
      });
    }
  }

  // Apply the changes to their rows, creating rows the template did not have.
  const rowsByNumber = new Map(parsed.rows.map((row) => [row.r, row]));
  for (const [address, change] of changes) {
    const position = XLSX.utils.decode_cell(address);
    const rowNumber = position.r + 1;
    let row = rowsByNumber.get(rowNumber);
    if (!row) {
      const source = [...parsed.rows].filter((candidate) => candidate.r < rowNumber).sort((a, b) => b.r - a.r)[0]
        || [...parsed.rows].sort((a, b) => a.r - b.r)[0];
      let attrs = source ? source.attrs : '';
      attrs = attrs.replace(/\s+r="[^"]*"/, '').replace(/\s+spans="[^"]*"/, '');
      attrs = ` r="${rowNumber}"${attrs}`;
      row = { r: rowNumber, attrs, cells: [], raw: null, selfClosing: false, dirty: false, changes: new Map() };
      parsed.rows.push(row);
      rowsByNumber.set(rowNumber, row);
    }
    const style = change.original?.style ?? nearestStyle(address, styles);
    const xml = buildCell(address, change.current, change.baseCell, change.original, {
      style,
      forceNormalFormula: change.forceNormalFormula
    });
    row.changes.set(address, xml);
    row.dirty = true;
  }

  const rows = [...parsed.rows].sort((a, b) => a.r - b.r);
  let minRow = Infinity;
  let maxRow = -1;
  let minColumn = Infinity;
  let maxColumn = -1;
  const serializedRows = rows.map((row) => {
    if (!row.dirty) return row.raw;
    const cells = new Map();
    for (const cell of row.cells) {
      if (row.changes.has(cell.address)) {
        const xml = row.changes.get(cell.address);
        if (xml) cells.set(cell.col, xml);
      } else {
        cells.set(cell.col, cell.raw);
      }
    }
    for (const [address, xml] of row.changes) {
      if (!xml) continue;
      const position = XLSX.utils.decode_cell(address);
      if (!cells.has(position.c)) cells.set(position.c, xml);
    }
    const columns = [...cells.keys()].sort((a, b) => a - b);
    if (columns.length) {
      minRow = Math.min(minRow, row.r - 1);
      maxRow = Math.max(maxRow, row.r - 1);
      minColumn = Math.min(minColumn, columns[0]);
      maxColumn = Math.max(maxColumn, columns[columns.length - 1]);
    }
    const attrs = updateSpans(row.attrs, columns.length ? columns[0] : 0, columns.length ? columns[columns.length - 1] : 0);
    const body = columns.map((column) => cells.get(column)).join('');
    return `<row${attrs}>${body}</row>`;
  });

  let nextXml = parsed.selfClosing
    ? `${sheetXml.slice(0, parsed.start - parsed.selfClosing.length)}<sheetData>${serializedRows.join('')}</sheetData>${sheetXml.slice(parsed.start)}`
    : `${sheetXml.slice(0, parsed.start)}${serializedRows.join('')}${sheetXml.slice(parsed.end)}`;

  // Only ever grow the used range; shrinking it would discard the original
  // file's sense of how much page it formatted.
  const dimension = nextXml.match(/<dimension\b[^>]*\bref="([^"]+)"[^>]*\/>/);
  if (dimension && maxRow >= 0) {
    const original = XLSX.utils.decode_range(dimension[1]);
    const start = { r: Math.min(original.s.r, minRow), c: Math.min(original.s.c, minColumn) };
    const end = { r: Math.max(original.e.r, maxRow), c: Math.max(original.e.c, maxColumn) };
    const ref = XLSX.utils.encode_range({ s: start, e: end });
    nextXml = nextXml.replace(/(<dimension\b[^>]*\bref=")[^"]*(")/, `$1${ref}$2`);
  }

  return { xml: nextXml, changed: true };
}

function forceFullCalc(workbookXml) {
  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*?)\/>/, (match, attrs) => {
      const clean = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/g, '');
      return `<calcPr${clean} fullCalcOnLoad="1"/>`;
    });
  }
  if (/<calcPr\b[^>]*>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)>/, (match, attrs) => {
      const clean = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/g, '');
      return `<calcPr${clean} fullCalcOnLoad="1">`;
    });
  }
  return workbookXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
}

function exportWorkbook(templateBuffer, sheets, fileName = 'sheet.xlsx') {
  const zip = unzipSync(new Uint8Array(templateBuffer));
  let workbook;
  try {
    workbook = XLSX.read(templateBuffer, {
      type: 'buffer',
      cellFormula: true,
      cellNF: true,
      cellStyles: true
    });
  } catch (error) {
    throw new TypeError('The original workbook could not be read for export');
  }
  const mapped = readSheetPaths(zip);
  if (!mapped.workbookXml) throw new TypeError('The original workbook has no workbook.xml');
  const names = mapped.names;
  let anyChange = false;

  for (const sheet of sheets) {
    let templateName = names.includes(sheet.name) ? sheet.name : null;
    if (!templateName && Number.isInteger(sheet.position) && names[sheet.position]) {
      templateName = names[sheet.position];
    }
    if (!templateName) continue;
    const path = mapped.paths[templateName];
    const file = zip[path];
    if (!file) continue;
    const baseline = workbook.Sheets[templateName] || {};
    const result = patchSheetXml(strFromU8(file), baseline, sheet);
    if (result.changed) {
      zip[path] = strToU8(result.xml);
      anyChange = true;
    }
  }

  if (!anyChange) {
    return { buffer: Buffer.from(templateBuffer), fileName };
  }
  zip['xl/workbook.xml'] = strToU8(forceFullCalc(mapped.workbookXml));
  const output = zipSync(zip, { level: 6 });
  return { buffer: Buffer.from(output), fileName };
}

module.exports = {
  exportWorkbook,
  patchSheetXml,
  forceFullCalc,
  sameCell,
  excelSerial
};
