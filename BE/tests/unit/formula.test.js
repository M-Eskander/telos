const formula = require('../../src/services/formula.service');

const cell = (value = null, formulaText = null, numberFormat = null) => {
  const stored = { v: value, f: formulaText };
  if (numberFormat) stored.z = numberFormat;
  return stored;
};

const sheet = (name, rows) => ({
  id: name,
  name,
  data: rows.map((row) => row.map((entry) => (
    entry && typeof entry === 'object' ? entry : cell(entry)
  )))
});

// A one-cell sheet with a formula, for the small questions. The formula sits
// just to the right of the data, so it can read the whole table without
// pointing at itself.
const valueOf = (formulaText, rows = []) => {
  const grid = rows.map((row) => row.map((entry) => (
    entry && typeof entry === 'object' ? { ...entry } : cell(entry)
  )));
  const width = grid.reduce((widest, row) => Math.max(widest, row.length), 0);
  if (!grid[0]) grid[0] = [];
  while (grid[0].length < width) grid[0].push(null);
  const target = width;
  grid[0][target] = cell(null, formulaText);
  const [result] = formula.recalculate([sheet('S', grid)]);
  return result.data[0][target].v;
};

describe('Spreadsheet formulas', () => {
  describe('arithmetic, text and comparisons', () => {
    test('follows Excel precedence', () => {
      expect(valueOf('1+2*3')).toBe(7);
      expect(valueOf('(1+2)*3')).toBe(9);
      expect(valueOf('-2^2')).toBe(4); // Excel reads this as (-2)^2
      expect(valueOf('2^3^2')).toBe(64); // left to right
      expect(valueOf('50%')).toBe(0.5);
    });

    test('joins text and reads escaped quotes', () => {
      expect(valueOf('"Art"&" / "&"Dev"')).toBe('Art / Dev');
      expect(valueOf('"She said ""yes"""')).toBe('She said "yes"');
    });

    test('compares like Excel, without caring about case', () => {
      expect(valueOf('1=1')).toBe(true);
      expect(valueOf('1<>2')).toBe(true);
      expect(valueOf('"A"="a"')).toBe(true);
      expect(valueOf('2>1')).toBe(true);
      expect(valueOf('1>=2')).toBe(false);
    });

    test('reports division by zero and bad text', () => {
      expect(valueOf('1/0')).toBe('#DIV/0!');
      expect(valueOf('"abc"+1')).toBe('#VALUE!');
    });
  });

  describe('cell references and ranges', () => {
    const numbers = [
      [cell(1), cell(4)],
      [cell(2), cell(5)],
      [cell(3), cell(6)]
    ];

    test('reads single cells', () => {
      expect(valueOf('A1+B2', numbers)).toBe(6);
      expect(valueOf('$A$3*2', numbers)).toBe(6);
    });

    test('adds, counts, averages, finds the smallest and largest', () => {
      expect(valueOf('SUM(A1:B3)', numbers)).toBe(21);
      expect(valueOf('AVERAGE(A1:A3)', numbers)).toBe(2);
      expect(valueOf('MIN(B1:B3)', numbers)).toBe(4);
      expect(valueOf('MAX(B1:B3)', numbers)).toBe(6);
      expect(valueOf('COUNT(A1:B3)', numbers)).toBe(6);
    });

    test('treats a blank cell as zero in arithmetic and empty in text', () => {
      expect(valueOf('B4+1', numbers)).toBe(1);
      expect(valueOf('B4=""', numbers)).toBe(true);
      expect(valueOf('B4=0', numbers)).toBe(true);
    });
  });

  describe('logic', () => {
    test('IF only shows the branch it picks', () => {
      expect(valueOf('IF(1<2,"yes","no")')).toBe('yes');
      expect(valueOf('IF(1>2,"yes","no")')).toBe('no');
      // The unchosen branch holds a division by zero; it must not leak out.
      expect(valueOf('IF(B1=0,0,10/B1)', [[cell(0), cell(0)]])).toBe(0);
    });

    test('IFERROR catches errors and lets good values through', () => {
      expect(valueOf('IFERROR(1/0,7)')).toBe(7);
      expect(valueOf('IFERROR(42,7)')).toBe(42);
      expect(valueOf('IFERROR(VLOOKUP("nobody",A1:B2,2,FALSE),0)', [
        [cell('a'), cell(1)],
        [cell('b'), cell(2)]
      ])).toBe(0);
    });

    test('OR, AND and FALSE work as the calculator writes them', () => {
      expect(valueOf('OR(1=1,2=3)')).toBe(true);
      expect(valueOf('OR(1=2,2=3)')).toBe(false);
      expect(valueOf('AND(1=1,2=2)')).toBe(true);
      expect(valueOf('FALSE()')).toBe(false);
    });

    test('marks a circular reference instead of hanging', () => {
      const [result] = formula.recalculate([sheet('S', [[
        cell(null, 'B1'),
        cell(null, 'A1')
      ]])]);
      expect(result.data[0][0].v).toBe('#CIRC!');
      expect(result.data[0][1].v).toBe('#CIRC!');
    });

    test('marks formulas it cannot read', () => {
      expect(valueOf('1+')).toBe('#NAME?');
      expect(valueOf('NOTAFUNCTION(1)')).toBe('#NAME?');
    });
  });

  describe('lookups', () => {
    const experience = [
      [cell('Junior'), cell(0.75)],
      [cell('Mid-Level'), cell(1)],
      [cell('Senior'), cell(1.5)]
    ];
    const workbook = [
      sheet('Experience Table', experience),
      sheet('S', [[
        cell(null, "VLOOKUP(\"mid-level\",'Experience Table'!$A$1:$B$3,2,FALSE)"),
        cell(null, "VLOOKUP(\"Senior\",'Experience Table'!$A$1:$B$3,2,FALSE())"),
        cell(null, "IFERROR(VLOOKUP(\"Nobody\",'Experience Table'!$A$1:$B$3,2,FALSE),0)"),
        cell(null, "VLOOKUP(\"Mid-Level\",'Experience Table'!$A$1:$B$3,9,FALSE)")
      ]])
    ];

    test('finds a value on another sheet, exactly, with FALSE or FALSE()', () => {
      const result = formula.recalculate(workbook);
      expect(result[1].data[0][0].v).toBe(1);
      expect(result[1].data[0][1].v).toBe(1.5);
      expect(result[1].data[0][2].v).toBe(0);
      expect(result[1].data[0][3].v).toBe('#REF!');
    });

    test('finds the nearest smaller value when asked to approximate', () => {
      expect(valueOf('VLOOKUP(7,A1:B3,2,TRUE)', [
        [cell(5), cell(20)],
        [cell(10), cell(30)],
        [cell(15), cell(40)]
      ])).toBe(20);
    });
  });

  describe('counting and adding with a condition', () => {
    const rows = [
      [cell('Art'), cell(10)],
      [cell('Dev'), cell(20)],
      [cell('Art'), cell(30)],
      [cell('Art'), cell(0)]
    ];

    test('COUNTIF matches text, numbers and comparisons', () => {
      expect(valueOf('COUNTIF(A1:A4,"Art")', rows)).toBe(3);
      expect(valueOf('COUNTIF(B1:B4,">0")', rows)).toBe(3);
      expect(valueOf('COUNTIF(A1:A4,"<>Art")', rows)).toBe(1);
      expect(valueOf('COUNTIF(B1:B4,0)', rows)).toBe(1);
      expect(valueOf('COUNTIF(A1:A4,"A*")', rows)).toBe(3);
    });

    test('SUMIF adds the matching rows', () => {
      expect(valueOf('SUMIF(A1:A4,"Art",B1:B4)', rows)).toBe(40);
      expect(valueOf('SUMIF(B1:B4,">=20")', rows)).toBe(50);
    });

    test('SUMIF stretches a single-cell sum range like Excel does', () => {
      expect(valueOf('SUMIF(A1:A4,"Art",B1)', rows)).toBe(40);
    });

    test('SUMIF with an array of criteria works inside SUMPRODUCT', () => {
      const result = formula.recalculate([
        sheet('Performance Table', [
          [cell('Meet Expectations'), cell(2)],
          [cell('Under-Perform'), cell(1)]
        ]),
        sheet('S', [
          [cell('Meet Expectations'), cell(10), cell(null,
            "SUMPRODUCT((B1:B3>0)*SUMIF('Performance Table'!A1:A2,A1:A3,'Performance Table'!B1:B2))"
          )],
          [cell('Under-Perform'), cell(0)],
          [cell('Meet Expectations'), cell(5)]
        ])
      ]);
      expect(result[1].data[0][2].v).toBe(4);
    });
  });

  describe('array arithmetic inside SUMPRODUCT', () => {
    const rows = [
      [cell('Art'), cell(10), cell('Meet Expectations')],
      [cell('Dev'), cell(0), cell('Under-Perform')],
      [cell('Art'), cell(5), cell('Meet Expectations')]
    ];

    test('multiplies arrays of comparisons and numbers', () => {
      expect(valueOf('SUMPRODUCT((A1:A3="Art")*(B1:B3>0))', rows)).toBe(2);
      expect(valueOf('SUMPRODUCT((A1:A3="Art")*(B1:B3>0)*B1:B3)', rows)).toBe(15);
    });

    test('works with LEFT over a range', () => {
      expect(valueOf('SUMPRODUCT((LEFT(C1:C3,13)<>"Under-Perform")*B1:B3)', rows)).toBe(15);
    });
  });

  describe('TEXT', () => {
    test('turns numbers into the studio formats', () => {
      expect(formula.formatWithPattern(0.0421, '0.00%')).toBe('4.21%');
      expect(formula.formatWithPattern(0.0421, '0.0%')).toBe('4.2%');
      expect(formula.formatWithPattern(0.04, '0%')).toBe('4%');
      expect(formula.formatWithPattern(13.3334, '0.0')).toBe('13.3');
      expect(formula.formatWithPattern(13.3334, '0.00')).toBe('13.33');
      expect(formula.formatWithPattern(36553.0602, '\\$#,##0')).toBe('$36,553');
      expect(formula.formatWithPattern(36553.06, '$#,##0.00')).toBe('$36,553.06');
      expect(formula.formatWithPattern(1.5, 'General')).toBe('1.5');
    });

    test('TEXT is usable inside a formula', () => {
      expect(valueOf('TEXT(0.0421,"0.00%")')).toBe('4.21%');
      expect(valueOf('IF(0=0,"",TEXT(1/0,"0.00%"))')).toBe('');
    });
  });

  describe('the calculator chain', () => {
    // A miniature of the studio calculator, with the same columns as the real
    // Team sheet: role weight, points, department pool, base pay and bonus.
    const team = [
      [cell('Name'), cell('Department'), cell('Role'), cell('Weight'), cell('Hours'), cell('Experience'), cell('Performance'), cell('Points'), cell('Dept Pool'), cell('Dept Points'), cell('Base'), cell('Cut'), cell('Bonus'), cell('Total')],
      [
        cell('A'), cell('Art'), cell('Animator'), cell(null, '1/COUNTIF($C$2:$C$3,C2)'), cell(40), cell('Mid-Level'), cell('Meet Expectations'),
        cell(null, 'IF(F2="",0,D2*E2*VLOOKUP(F2,\'Experience Table\'!$A$1:$B$3,2,FALSE))'),
        cell(null, 'VLOOKUP(B2,Departments!$A$1:$B$2,2,FALSE)'),
        cell(null, 'SUMIF($C$2:$C$3,C2,H2:H3)'),
        cell(null, 'IF(J2=0,0,I2*(H2/J2))'),
        cell(null, 'IF(LEFT(G2,13)="Under-Perform",K2-VLOOKUP(G2,\'Performance Table\'!$A$1:$B$2,2,FALSE)*K2,0)'),
        cell(null, "IFERROR(VLOOKUP(B2,Departments!$A$1:$C$2,3,FALSE)*(VLOOKUP(G2,'Performance Table'!$A$1:$B$2,2,FALSE)/SUMPRODUCT((B2:B3=B2)*(LEFT(G2:G3,13)<>\"Under-Perform\")*(E2:E3>0)*SUMIF('Performance Table'!$A$1:$A$2,G2:G3,'Performance Table'!$B$1:$B$2))),0)"),
        cell(null, 'K2+M2-L2')
      ],
      [
        cell('B'), cell('Art'), cell('Animator'), cell(null, '1/COUNTIF($C$2:$C$3,C3)'), cell(30), cell('Junior'), cell('Meet Expectations'),
        cell(null, 'IF(F3="",0,D3*E3*VLOOKUP(F3,\'Experience Table\'!$A$1:$B$3,2,FALSE))'),
        cell(null, 'VLOOKUP(B3,Departments!$A$1:$B$2,2,FALSE)'),
        cell(null, 'SUMIF($C$2:$C$3,C3,H2:H3)'),
        cell(null, 'IF(J3=0,0,I3*(H3/J3))'),
        cell(null, 'IF(LEFT(G3,13)="Under-Perform",K3-VLOOKUP(G3,\'Performance Table\'!$A$1:$B$2,2,FALSE)*K3,0)'),
        cell(null, "IFERROR(VLOOKUP(B3,Departments!$A$1:$C$2,3,FALSE)*(VLOOKUP(G3,'Performance Table'!$A$1:$B$2,2,FALSE)/SUMPRODUCT((B2:B3=B3)*(LEFT(G2:G3,13)<>\"Under-Perform\")*(E2:E3>0)*SUMIF('Performance Table'!$A$1:$A$2,G2:G3,'Performance Table'!$B$1:$B$2))),0)"),
        cell(null, 'K3+M3-L3')
      ]
    ];

    test('moves hours and experience through points, pay and the bonus', () => {
      const result = formula.recalculate([
        sheet('Experience Table', [
          [cell('Junior'), cell(0.75)],
          [cell('Mid-Level'), cell(1)],
          [cell('Senior'), cell(1.5)]
        ]),
        sheet('Performance Table', [
          [cell('Meet Expectations'), cell(2)],
          [cell('Under-Perform'), cell(1)]
        ]),
        sheet('Departments', [
          [cell('Art'), cell(1000), cell(3)],
          [cell('Dev'), cell(500), cell(1)]
        ]),
        sheet('Team', team)
      ]);
      const rows = result.find((entry) => entry.name === 'Team').data;
      // Two people with the same role: each carries half the role weight.
      expect(rows[1][3].v).toBe(0.5);
      expect(rows[2][3].v).toBe(0.5);
      // Points = weight x hours x experience multiplier.
      expect(rows[1][7].v).toBe(20); // 0.5 × 40 × 1
      expect(rows[2][7].v).toBeCloseTo(11.25, 10); // 0.5 × 30 × 0.75
      // Both are the only Animators, so the role's points are 31.25.
      expect(rows[1][9].v).toBeCloseTo(31.25, 10);
      // Art has a 1000 pool: split by points.
      expect(rows[1][10].v).toBeCloseTo(640, 10);
      expect(rows[2][10].v).toBeCloseTo(360, 10);
      // Nobody is under-performing, so no cut.
      expect(rows[1][11].v).toBe(0);
      // Bonus: art rate 3 × (performance weight 2 / total 4) = 1.5 for each.
      expect(rows[1][12].v).toBeCloseTo(1.5, 10);
      expect(rows[2][12].v).toBeCloseTo(1.5, 10);
      expect(rows[1][13].v).toBeCloseTo(641.5, 10);
      expect(rows[2][13].v).toBeCloseTo(361.5, 10);
    });

    test('a changed hours cell moves the whole chain', () => {
      const edited = team.map((row) => row.map((entry) => ({ ...entry })));
      edited[2][4] = cell(10); // B now works 10 hours
      const result = formula.recalculate([
        sheet('Experience Table', [
          [cell('Junior'), cell(0.75)],
          [cell('Mid-Level'), cell(1)],
          [cell('Senior'), cell(1.5)]
        ]),
        sheet('Performance Table', [
          [cell('Meet Expectations'), cell(2)],
          [cell('Under-Perform'), cell(1)]
        ]),
        sheet('Departments', [
          [cell('Art'), cell(1000), cell(3)],
          [cell('Dev'), cell(500), cell(1)]
        ]),
        sheet('Team', edited)
      ]);
      const rows = result.find((entry) => entry.name === 'Team').data;
      expect(rows[2][7].v).toBeCloseTo(3.75, 10); // 0.5 × 10 × 0.75
      const totalPoints = 20 + 3.75;
      expect(rows[1][10].v).toBeCloseTo(1000 * (20 / totalPoints), 10);
      expect(rows[2][10].v).toBeCloseTo(1000 * (3.75 / totalPoints), 10);
      // Both still carry 1.5 each.
      expect(rows[1][13].v).toBeCloseTo(1000 * (20 / totalPoints) + 1.5, 10);
      expect(rows[2][13].v).toBeCloseTo(1000 * (3.75 / totalPoints) + 1.5, 10);
    });
  });
});
