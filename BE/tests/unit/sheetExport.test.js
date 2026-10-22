const XLSX = require('xlsx');
const { unzipSync, strFromU8 } = require('fflate');
const sheetService = require('../../src/services/sheet.service');
const formulaService = require('../../src/services/formula.service');
const sheetExport = require('../../src/services/sheetExport.service');
const { buildFormulaWorkbook } = require('../fixtures/formulaWorkbook');

const TEMPLATE = buildFormulaWorkbook();

function loadSheets() {
  const parsed = sheetService.parseWorkbook(TEMPLATE, 'formula.xlsx');
  return parsed.sheets.map((sheet) => ({
    ...sheet,
    meta: JSON.parse(JSON.stringify(sheet.meta)),
    data: sheet.data.map((row) => row.map((cell) => (cell ? { ...cell } : null)))
  }));
}

function exportSheets(sheets) {
  return sheetExport.exportWorkbook(TEMPLATE, formulaService.recalculate(sheets), 'formula.xlsx');
}

function packageOf(buffer) {
  const zip = unzipSync(new Uint8Array(buffer));
  return {
    zip,
    text: (name) => strFromU8(zip[name]),
    sheet: () => strFromU8(zip['xl/worksheets/sheet1.xml'])
  };
}

function cellsOf(xml) {
  const cells = new Map();
  const pattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    const address = (match[1].match(/\br="([^"]+)"/) || [])[1];
    if (address) cells.set(address, match[0]);
  }
  return cells;
}

function changedCells(beforeXml, afterXml) {
  const before = cellsOf(beforeXml);
  const after = cellsOf(afterXml);
  const changed = [];
  for (const address of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(address) !== after.get(address)) changed.push(address);
  }
  return changed.sort((a, b) => XLSX.utils.decode_cell(a).r - XLSX.utils.decode_cell(b).r
    || XLSX.utils.decode_cell(a).c - XLSX.utils.decode_cell(b).c);
}

function sectionOf(xml, tag) {
  const matches = String(xml).match(new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'));
  return matches ? matches.join('\n') : '';
}

function formulasAndFormats(buffer) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer', cellFormula: true, cellNF: true, cellStyles: true
  });
  const cells = {};
  for (const name of workbook.SheetNames) {
    for (const [address, cell] of Object.entries(workbook.Sheets[name])) {
      if (address[0] === '!') continue;
      cells[`${name}!${address}`] = { f: cell.f || null, z: cell.z || null };
    }
  }
  return cells;
}

describe('template-preserving spreadsheet export', () => {
  test('returns the original bytes when nothing changed', () => {
    const result = exportSheets(loadSheets());
    expect(Buffer.compare(result.buffer, TEMPLATE)).toBe(0);
    expect(result.fileName).toBe('formula.xlsx');
  });

  test('writes one input and the cached values that depend on it, keeping every formula and format', () => {
    const sheets = loadSheets();
    sheets[0].data[1][0] = { ...sheets[0].data[1][0], v: 15 };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);

    expect(next.text('xl/styles.xml')).toBe(base.text('xl/styles.xml'));
    expect(next.text('xl/worksheets/sheet1.xml').match(/<cols>[\s\S]*?<\/cols>/)[0])
      .toBe(base.text('xl/worksheets/sheet1.xml').match(/<cols>[\s\S]*?<\/cols>/)[0]);
    for (const tag of ['mergeCells', 'dataValidations', 'conditionalFormatting']) {
      expect(sectionOf(next.sheet(), tag)).toBe(sectionOf(base.sheet(), tag));
    }

    const changed = changedCells(base.sheet(), next.sheet());
    expect(changed).toEqual(['A2', 'B2']);
    expect(cellsOf(next.sheet()).get('A2')).toBe('<c r="A2" s="2"><v>15</v></c>');
    expect(cellsOf(next.sheet()).get('B2'))
      .toContain('<f t="shared" ref="B2:B4" si="1">A2*2</f><v>30</v>');
    expect(cellsOf(next.sheet()).get('B3')).toContain('<f t="shared" si="1"/>');
    expect(cellsOf(next.sheet()).get('B4')).toContain('<f t="shared" si="1"/>');

    expect(formulasAndFormats(result.buffer)).toEqual(formulasAndFormats(TEMPLATE));
    expect(next.text('xl/workbook.xml')).toContain('<calcPr calcId="191029" fullCalcOnLoad="1"/>');
    expect(next.sheet()).toContain('<dimension ref="A1:D5"/>');

    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[1][0].v).toBe(15);
    expect(roundTrip.data[1][1].v).toBe(30);
    expect(roundTrip.data[1][1].f).toBe('A2*2');
    expect(roundTrip.data[2][1].f).toBe('A3*2');
  });

  test('changes a label without touching any other cell', () => {
    const sheets = loadSheets();
    sheets[0].data[0][0] = { ...sheets[0].data[0][0], v: 'Inputs (edited)' };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);

    expect(changedCells(base.sheet(), next.sheet())).toEqual(['A1']);
    expect(cellsOf(next.sheet()).get('A1'))
      .toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Inputs (edited)</t></is></c>');
    expect(next.text('xl/styles.xml')).toBe(base.text('xl/styles.xml'));
    for (const tag of ['cols', 'mergeCells', 'dataValidations', 'conditionalFormatting']) {
      expect(sectionOf(next.sheet(), tag)).toBe(sectionOf(base.sheet(), tag));
    }

    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[0][0].v).toBe('Inputs (edited)');
    expect(roundTrip.data[1][1].f).toBe('A2*2');
  });

  test('adds a row past the template, inheriting the styles above and growing the dimension', () => {
    const sheets = loadSheets();
    sheets[0].data.push([]);
    sheets[0].data[5][0] = { v: 5, f: null };
    sheets[0].data[5][1] = { v: 10, f: 'A6*2' };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);

    const cells = cellsOf(next.sheet());
    expect(changedCells(base.sheet(), next.sheet())).toEqual(['A6', 'B6']);
    expect(cells.get('A6')).toBe('<c r="A6" s="2"><v>5</v></c>');
    expect(cells.get('B6')).toBe('<c r="B6" s="3"><f>A6*2</f><v>10</v></c>');
    expect(next.sheet()).toContain('<dimension ref="A1:D6"/>');
    expect(next.sheet()).toContain('<row r="6">');
    expect(cells.get('B2')).toContain('<f t="shared" ref="B2:B4" si="1">A2*2</f>');

    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[5][0].v).toBe(5);
    expect(roundTrip.data[5][1]).toMatchObject({ v: 10, f: 'A6*2' });
    expect(roundTrip.data[5][0].s).toMatchObject({ bd: { t: 'cccccc' } });
  });

  test('writes dates and percentages back in the formats the template gave them', () => {
    const sheets = loadSheets();
    sheets[0].data[1][2] = { ...sheets[0].data[1][2], v: '2025-01-01' };
    sheets[0].data[1][3] = { ...sheets[0].data[1][3], v: 0.4 };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);
    const cells = cellsOf(next.sheet());

    expect(changedCells(base.sheet(), next.sheet())).toEqual(['C2', 'D2']);
    expect(cells.get('C2')).toBe('<c r="C2" s="4"><v>45658</v></c>');
    expect(cells.get('D2')).toBe('<c r="D2" s="5"><v>0.4</v></c>');

    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[1][2]).toMatchObject({ v: '2025-01-01', z: 'm/d/yy' });
    expect(roundTrip.data[1][3]).toMatchObject({ v: 0.4, z: '0.00%' });
  });

  test('converts a whole shared group when one formula in it changes', () => {
    const sheets = loadSheets();
    sheets[0].data[1][1] = { ...sheets[0].data[1][1], f: 'A2*3' };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);
    const cells = cellsOf(next.sheet());

    expect(changedCells(base.sheet(), next.sheet())).toEqual(['B2', 'B3', 'B4']);
    expect(next.sheet()).not.toContain('t="shared"');
    expect(cells.get('B2')).toBe('<c r="B2" s="3"><f>A2*3</f><v>30</v></c>');
    expect(cells.get('B3')).toBe('<c r="B3" s="3"><f>A3*2</f><v>40</v></c>');
    expect(cells.get('B4')).toBe('<c r="B4" s="3"><f>A4*2</f><v>60</v></c>');

    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[1][1]).toMatchObject({ v: 30, f: 'A2*3' });
    expect(roundTrip.data[2][1]).toMatchObject({ v: 40, f: 'A3*2' });
    expect(roundTrip.data[3][1]).toMatchObject({ v: 60, f: 'A4*2' });
  });

  test('converts a shared group past the imported window without losing its values', () => {
    const sheets = loadSheets();
    const data = sheets[0].data.slice(0, 3);
    sheets[0] = {
      ...sheets[0],
      data,
      meta: { ...sheets[0].meta, imported: { rows: 3, cols: 4 } }
    };
    data[1][1] = { ...data[1][1], f: 'A2*3' };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);
    const cells = cellsOf(next.sheet());

    expect(next.sheet()).not.toContain('t="shared"');
    expect(cells.get('B2')).toBe('<c r="B2" s="3"><f>A2*3</f><v>30</v></c>');
    expect(cells.get('B3')).toBe('<c r="B3" s="3"><f>A3*2</f><v>40</v></c>');
    expect(cells.get('B4')).toBe('<c r="B4" s="3"><f>A4*2</f><v>60</v></c>');
    for (const address of ['C2', 'D2', 'C5', 'D5']) {
      expect(cells.get(address)).toBe(cellsOf(base.sheet()).get(address));
    }

    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[3][1]).toMatchObject({ v: 60, f: 'A4*2' });
  });

  test('clears a cell while leaving its border and its formula-dependent neighbour calculable', () => {
    const sheets = loadSheets();
    sheets[0].data[1][0] = { v: null, f: null };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);
    const cells = cellsOf(next.sheet());

    expect(cells.get('A2')).toBe('<c r="A2" s="2"/>');
    expect(cells.get('B2')).toContain('<f t="shared" ref="B2:B4" si="1">A2*2</f>');
    expect(changedCells(base.sheet(), next.sheet())).toEqual(['A2', 'B2']);

    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[1][0]).toMatchObject({ v: null, f: null });
    expect(roundTrip.data[1][1].f).toBe('A2*2');
    expect(roundTrip.data[1][1].v).toBe(0);
  });

  test('leaves rows and columns outside the imported window untouched', () => {
    const sheets = loadSheets();
    // Simulate an import that stopped after A1:B4.
    const data = sheets[0].data.slice(0, 4).map((row) => row.slice(0, 2));
    sheets[0] = {
      ...sheets[0],
      data,
      meta: { ...sheets[0].meta, imported: { rows: 4, cols: 2 } }
    };
    data[1][0] = { ...data[1][0], v: 15 };
    const result = exportSheets(sheets);
    const base = packageOf(TEMPLATE);
    const next = packageOf(result.buffer);
    const before = cellsOf(base.sheet());
    const after = cellsOf(next.sheet());

    for (const address of ['C2', 'D2', 'C5', 'D5']) {
      expect(after.get(address)).toBe(before.get(address));
    }
    expect(changedCells(base.sheet(), next.sheet())).toEqual(['A2', 'B2']);
    const roundTrip = sheetService.parseWorkbook(result.buffer, 'formula.xlsx').sheets[0];
    expect(roundTrip.data[1][2].v).toBe('2024-01-01');
    expect(roundTrip.data[1][3].v).toBe(0.25);
    expect(roundTrip.data[4][3].v).toBe(0.5);
  });

  test('marks the workbook for a full recalculation in every calcPr shape', () => {
    expect(sheetExport.forceFullCalc('<workbook><calcPr calcId="1"/></workbook>'))
      .toBe('<workbook><calcPr calcId="1" fullCalcOnLoad="1"/></workbook>');
    expect(sheetExport.forceFullCalc('<workbook><calcPr/></workbook>'))
      .toBe('<workbook><calcPr fullCalcOnLoad="1"/></workbook>');
    expect(sheetExport.forceFullCalc('<workbook><calcPr calcId="1" fullCalcOnLoad="0"></calcPr></workbook>'))
      .toBe('<workbook><calcPr calcId="1" fullCalcOnLoad="1"></calcPr></workbook>');
    expect(sheetExport.forceFullCalc('<workbook></workbook>'))
      .toBe('<workbook><calcPr fullCalcOnLoad="1"/></workbook>');
  });

  test('uses the 1900 date system for serial dates', () => {
    expect(sheetExport.excelSerial('2024-01-01')).toBe(45292);
    expect(sheetExport.excelSerial('2025-01-01')).toBe(45658);
  });
});
