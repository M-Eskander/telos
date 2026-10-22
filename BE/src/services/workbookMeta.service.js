const XLSX = require('xlsx');
const { unzipSync, strFromU8 } = require('fflate');

// SheetJS can read the numbers and the formulas of a workbook, but the
// community build only exposes a cell's fill. The studio's calculator also
// uses bold headings, white type on dark bands, borders, alignment, merged
// cells, column widths and row heights. Those live in the workbook's XML, so
// this module reads that XML itself and hands the app a small style for each
// cell. It is deliberately forgiving: a file we cannot style still imports.

const THEME_FALLBACK = {
  0: 'ffffff',
  1: '1f1f1f',
  2: '44546a',
  3: 'd9e2f3',
  4: '4472c4'
};

const decodeXml = (text) => String(text).replace(/&(amp|lt|gt|quot|apos);/g, (match, entity) => ({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}[entity]));

const attribute = (tag, name) => {
  if (!tag) return null;
  const pattern = new RegExp('(?:^|\\s)' + name + '="([^"]*)"');
  const match = String(tag).match(pattern);
  return match ? decodeXml(match[1]) : null;
};

const section = (xml, name) => {
  const match = String(xml || '').match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>'));
  return match ? match[1] : '';
};

// Elements of one kind, self-closing or with a body. The names in this file
// do not nest inside themselves, so a non-greedy match is enough.
const elements = (xml, name) => {
  const pattern = new RegExp('<' + name + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + name + '>)', 'g');
  const found = [];
  let match;
  while ((match = pattern.exec(String(xml || ''))) !== null) found.push(match[0]);
  return found;
};

const colorHex = (tag) => {
  if (!tag) return null;
  const rgb = attribute(tag, 'rgb');
  if (rgb && /^[0-9a-f]{6}/i.test(rgb)) {
    const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
    return /^0{6}$/i.test(hex) ? null : hex.toLowerCase();
  }
  const theme = attribute(tag, 'theme');
  if (theme !== null) {
    const fallback = THEME_FALLBACK[Number(theme)];
    return fallback && fallback !== 'ffffff' && fallback !== '1f1f1f' ? fallback : null;
  }
  return null;
};

const firstColor = (xml) => {
  const match = String(xml || '').match(/<color\b[^>]*>/);
  return colorHex(match ? match[0] : '');
};

function readFont(xml) {
  const style = {};
  if (/<b(?:\s|\/|>)/.test(xml)) style.b = 1;
  if (/<i(?:\s|\/|>)/.test(xml)) style.i = 1;
  if (/<u(?:\s|\/|>)/.test(xml)) style.u = 1;
  const size = String(xml).match(/<sz\b[^>]*\bval="([0-9.]+)"/);
  if (size && Number(size[1]) && Number(size[1]) !== 11) style.sz = Number(size[1]);
  const color = firstColor(xml);
  if (color) style.c = color;
  return style;
}

function readFill(xml) {
  const patternTag = String(xml).match(/<patternFill\b[^>]*>/);
  const pattern = attribute(patternTag ? patternTag[0] : '', 'patternType');
  if (!pattern || pattern === 'none') return null;
  if (pattern === 'lightGray') return { fill: 'e8e2d6' };
  if (pattern === 'gray125') return null;
  const foreground = String(xml).match(/<fgColor\b[^>]*>/);
  const color = colorHex(foreground ? foreground[0] : '');
  // White is the paper of the page, not a highlight.
  if (!color || color === 'ffffff') return null;
  return { fill: color };
}

function readBorder(xml) {
  const border = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const match = String(xml).match(new RegExp('<' + side + '\\b([^>]*)>([\\s\\S]*?)</' + side + '>'));
    if (!match) continue;
    const style = attribute('<x ' + match[1] + '>', 'style');
    if (!style) continue;
    const color = firstColor(match[2]) || 'cccccc';
    border[side[0]] = style === 'medium' || style === 'thick' ? { c: color, w: 2 } : color;
  }
  return Object.keys(border).length ? border : null;
}

function readAlignment(xml) {
  const tag = String(xml).match(/<alignment\b[^>]*>/);
  if (!tag) return {};
  const alignment = {};
  const horizontal = attribute(tag[0], 'horizontal');
  if (horizontal && horizontal !== 'general' && horizontal !== 'left') {
    alignment.a = horizontal === 'centerContinuous' ? 'center' : horizontal;
  }
  const vertical = attribute(tag[0], 'vertical');
  if (vertical === 'center') alignment.va = 'middle';
  else if (vertical === 'top') alignment.va = 'top';
  const wrap = attribute(tag[0], 'wrapText');
  if (wrap === '1' || wrap === 'true') alignment.wrap = 1;
  return alignment;
}

// cellXfs[n] is the style the s="n" attribute on a cell points at.
function readCellStyles(stylesXml) {
  const fonts = elements(section(stylesXml, 'fonts'), 'font').map(readFont);
  const fills = elements(section(stylesXml, 'fills'), 'fill').map(readFill);
  const borders = elements(section(stylesXml, 'borders'), 'border').map(readBorder);
  return elements(section(stylesXml, 'cellXfs'), 'xf').map((xf) => {
    const style = {};
    const font = fonts[Number(attribute(xf, 'fontId')) || 0];
    const fill = fills[Number(attribute(xf, 'fillId')) || 0];
    const border = borders[Number(attribute(xf, 'borderId')) || 0];
    if (font) Object.assign(style, font);
    if (fill) style.fill = fill.fill;
    if (border) style.bd = border;
    Object.assign(style, readAlignment(xf));
    return Object.keys(style).length ? style : null;
  });
}

// A map of "B5" -> style for the cells that carry one.
function readSheetStyles(sheetXml, cellStyles) {
  const styles = new Map();
  const cells = String(sheetXml || '').match(/<c\b[^>]*?(?:\/>|>)/g) || [];
  for (const tag of cells) {
    const address = attribute(tag, 'r');
    const index = attribute(tag, 's');
    if (!address || index === null) continue;
    const style = cellStyles[Number(index)];
    if (style) styles.set(address, style);
  }
  return styles;
}

const columnPixels = (column) => {
  if (!column) return null;
  if (Number(column.wpx) > 0) return Math.round(column.wpx);
  if (Number(column.width) > 0) return Math.round(Number(column.width) * 7 + 5);
  if (Number(column.wch) > 0) return Math.round(Number(column.wch) * 7 + 5);
  return null;
};

const rowPixels = (row) => {
  if (!row) return null;
  // SheetJS reports 15.75pt rows as hpx: 15.75, so trust the points here.
  if (Number(row.hpt) > 0) return Math.round(Number(row.hpt) * 4 / 3);
  if (Number(row.hpx) > 0) return Math.round(Number(row.hpx));
  return null;
};

// The calculator has no frozen panes, so we choose the useful ones: the table
// heading near the top (when there is one) and the label/Name column. The app
// treats the frozen heading as the single sticky header row.
function chooseFreeze(worksheet) {
  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;
  const lastRow = Math.min(range ? range.e.r : 0, 12);
  let headerRow = -1;
  for (let row = 0; row <= lastRow; row += 1) {
    let filled = 0;
    for (let column = 0; column <= Math.max(range ? range.e.c : 0, 8); column += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && cell.v !== null && cell.v !== undefined && cell.v !== '') filled += 1;
    }
    if (filled >= 4) {
      headerRow = row;
      break;
    }
  }
  // Do not freeze half the page because a long form has a table far down it.
  if (headerRow > 5) headerRow = -1;
  return { r: headerRow + 1, c: 2 };
}

function readWorkbookMeta(buffer, workbook) {
  const empty = { byName: {} };
  let zip;
  try {
    zip = unzipSync(new Uint8Array(buffer));
  } catch (error) {
    return empty;
  }
  const workbookFile = zip['xl/workbook.xml'];
  const relsFile = zip['xl/_rels/workbook.xml.rels'];
  if (!workbookFile || !relsFile) return empty;

  const workbookXml = strFromU8(workbookFile);
  const rels = {};
  for (const relationship of elements(strFromU8(relsFile), 'Relationship')) {
    const id = attribute(relationship, 'Id');
    const target = attribute(relationship, 'Target');
    if (id && target) {
      const normalized = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      rels[id] = normalized.replace(/^xl\/\.\.\//, '');
    }
  }

  let cellStyles = [];
  if (zip['xl/styles.xml']) {
    try {
      cellStyles = readCellStyles(strFromU8(zip['xl/styles.xml']));
    } catch (error) {
      cellStyles = [];
    }
  }

  const byName = {};
  for (const tag of elements(workbookXml, 'sheet')) {
    const name = attribute(tag, 'name');
    const relationship = attribute(tag, 'r:id');
    if (!name || !relationship || !rels[relationship]) continue;
    const sheetFile = zip[rels[relationship]];
    if (!sheetFile) continue;
    let styles = new Map();
    try {
      styles = readSheetStyles(strFromU8(sheetFile), cellStyles);
    } catch (error) {
      styles = new Map();
    }
    const worksheet = workbook.Sheets[name] || {};
    const columns = [];
    for (let index = 0; index < (worksheet['!cols'] || []).length; index += 1) {
      columns[index] = columnPixels(worksheet['!cols'][index]);
    }
    const rows = {};
    (worksheet['!rows'] || []).forEach((row, index) => {
      const height = rowPixels(row);
      if (height) rows[index] = height;
    });
    const merges = (worksheet['!merges'] || []).map((merge) => ({
      s: { r: merge.s.r, c: merge.s.c },
      e: { r: merge.e.r, c: merge.e.c }
    }));
    byName[name] = {
      styles,
      columns,
      rows,
      merges,
      freeze: chooseFreeze(worksheet)
    };
  }
  return { byName };
}

module.exports = {
  readWorkbookMeta,
  readCellStyles,
  readSheetStyles,
  chooseFreeze,
  columnPixels,
  rowPixels
};
