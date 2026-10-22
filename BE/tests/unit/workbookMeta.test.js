const XLSX = require('xlsx');
const workbookMeta = require('../../src/services/workbookMeta.service');
const sheetService = require('../../src/services/sheet.service');
const { buildStyledWorkbook } = require('../fixtures/styledWorkbook');

const readStyled = () => {
  const buffer = buildStyledWorkbook();
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: true,
    cellDates: true,
    cellNF: true,
    cellStyles: true
  });
  return { buffer, workbook, meta: workbookMeta.readWorkbookMeta(buffer, workbook) };
};

describe('workbook metadata', () => {
  test('reads fonts, fills, borders, alignment, widths, heights, merges and a frozen heading', () => {
    const { meta } = readStyled();
    const sheet = meta.byName.Sheet1;
    expect(sheet).toBeTruthy();
    expect(sheet.columns[0]).toBe(120); // 20 characters, as SheetJS measures it
    expect(sheet.columns[1]).toBe(180);
    expect(sheet.rows[0]).toBe(40); // 30pt
    expect(sheet.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]);
    expect(sheet.freeze).toEqual({ r: 1, c: 2 });

    expect(sheet.styles.get('A1')).toEqual({
      sz: 14,
      b: 1,
      c: 'ffffff',
      fill: '1f2937',
      bd: { t: 'cccccc', r: 'cccccc', b: 'cccccc', l: 'cccccc' },
      a: 'center',
      va: 'middle',
      wrap: 1
    });
    expect(sheet.styles.get('A2')).toEqual({
      i: 1,
      c: '666666',
      bd: { t: 'cccccc', r: 'cccccc', b: 'cccccc', l: 'cccccc' },
      a: 'right',
      va: 'top'
    });
    // A default cell has no style entry at all.
    expect(sheet.styles.has('B2')).toBe(false);
  });

  test('turns a styled upload into grid cells and sheet metadata', () => {
    const buffer = buildStyledWorkbook();
    const result = sheetService.parseWorkbook(buffer, 'styled.xlsx');
    expect(result.warnings).toEqual([]);
    const sheet = result.sheets[0];
    expect(sheet.data[0][0]).toMatchObject({ v: 'Title', f: null });
    expect(sheet.data[0][0].s).toMatchObject({ b: 1, fill: '1f2937' });
    expect(sheet.data[1][0]).toMatchObject({ v: 42, f: null });
    expect(sheet.data[1][0].s).toMatchObject({ i: 1, a: 'right' });
    expect(sheet.meta.cols).toEqual([120, 180, null, null]);
    expect(sheet.meta.rows).toEqual({ 0: 40 });
    expect(sheet.meta.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]);
    expect(sheet.meta.freeze).toEqual({ r: 1, c: 2 });
  });

  test('warns only when real data is outside the 400 by 60 limits', () => {
    const wb = XLSX.utils.book_new();
    const ws = {};
    for (let row = 0; row < 450; row += 1) {
      for (let column = 0; column < 65; column += 1) {
        if (row < 5 || column < 3 || row > 440 || column > 60) {
          ws[XLSX.utils.encode_cell({ r: row, c: column })] = { t: 'n', v: row + column };
        }
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 449, c: 64 } });
    ws[XLSX.utils.encode_cell({ r: 1, c: 1 })] = { t: 's', v: 'x'.repeat(2100) };
    XLSX.utils.book_append_sheet(wb, ws, 'Wide');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = sheetService.parseWorkbook(buffer, 'wide.xlsx');
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain('only the first 400 rows');
    expect(result.warnings[1]).toContain('only the first 60 columns');
    expect(result.warnings[2]).toContain('shortened');
    expect(result.sheets[0].data).toHaveLength(400);
    expect(result.sheets[0].data[1][1].v).toHaveLength(2000);
    expect(result.sheets[0].meta.truncated).toEqual(result.warnings);
  });

  test('does not warn about empty formatted rows below the limit', () => {
    const wb = XLSX.utils.book_new();
    const ws = { A1: { t: 's', v: 'Title' } };
    ws['!ref'] = 'A1:A1000';
    XLSX.utils.book_append_sheet(wb, ws, 'Tall');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = sheetService.parseWorkbook(buffer, 'tall.xlsx');
    expect(result.warnings).toEqual([]);
    expect(result.sheets[0].meta.truncated).toBeUndefined();
  });

  test('converts points to pixels for row heights', () => {
    expect(workbookMeta.rowPixels({ hpt: 15.75 })).toBe(21);
    expect(workbookMeta.rowPixels({ hpx: 30 })).toBe(30);
    expect(workbookMeta.rowPixels({})).toBeNull();
    expect(workbookMeta.columnPixels({ wpx: 156 })).toBe(156);
    expect(workbookMeta.columnPixels({ wch: 20 })).toBe(145);
    expect(workbookMeta.columnPixels({})).toBeNull();
  });
});
