// --- a small spreadsheet engine -------------------------------------------
// The studio's calculator is an Excel file, and it has to keep calculating in
// the app. This reads the formulas the file carries (`cell.f`), works out what
// they mean against the other cells (including other sheets), and writes the
// answer back into `cell.v` while keeping the formula.
//
// It covers the functions the calculator uses: IF, IFERROR, OR, LEFT, TEXT,
// VLOOKUP, COUNTIF, SUMIF, SUMPRODUCT, SUM, FALSE. The arithmetic, comparisons
// and ranges those formulas build on are all here, plus a second row of common
// functions so other sheets have somewhere to stand.

const MAX_RANGE_CELLS = 5000;

const ERROR_CODES = new Set([
  '#DIV/0!', '#N/A', '#VALUE!', '#NAME?', '#REF!', '#NUM!', '#NULL!', '#CIRC!'
]);

class FormulaError {
  constructor(code) {
    this.code = code;
  }
}

class RangeValue {
  constructor(rows, sheet = null, startRow = 0, startColumn = 0) {
    this.rows = rows;
    this.sheet = sheet;
    this.startRow = startRow;
    this.startColumn = startColumn;
  }
}

const errorValue = (code) => new FormulaError(code);
const isError = (value) => value instanceof FormulaError;
const isRange = (value) => value instanceof RangeValue;

class ParseError extends Error {}

// --- values ---------------------------------------------------------------
function numberText(value) {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const text = String(Number(value.toPrecision(15)));
  return text;
}

function toScalar(value) {
  if (!isRange(value)) return value;
  const firstRow = value.rows[0] || [];
  return firstRow.length ? firstRow[0] : null;
}

function toNumber(value) {
  if (isError(value)) return value;
  const scalar = toScalar(value);
  if (scalar === null || scalar === undefined) return 0;
  if (typeof scalar === 'number') return Number.isFinite(scalar) ? scalar : errorValue('#NUM!');
  if (typeof scalar === 'boolean') return scalar ? 1 : 0;
  const text = String(scalar).trim();
  if (text === '') return 0;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : errorValue('#VALUE!');
}

function toText(value) {
  if (isError(value)) return value.code;
  const scalar = toScalar(value);
  if (scalar === null || scalar === undefined) return '';
  if (typeof scalar === 'number') return numberText(scalar);
  if (typeof scalar === 'boolean') return scalar ? 'TRUE' : 'FALSE';
  return String(scalar);
}

function toBoolean(value) {
  if (isError(value)) return value;
  const scalar = toScalar(value);
  if (scalar === null || scalar === undefined) return false;
  if (typeof scalar === 'boolean') return scalar;
  if (typeof scalar === 'number') return scalar !== 0;
  const text = String(scalar).trim().toUpperCase();
  if (text === 'TRUE') return true;
  if (text === 'FALSE') return false;
  return errorValue('#VALUE!');
}

// Excel puts numbers before text before booleans; blanks act as 0 or "".
function comparisonParts(left, right) {
  let a = toScalar(left);
  let b = toScalar(right);
  if (a === null || a === undefined) a = typeof b === 'number' ? 0 : (typeof b === 'boolean' ? false : '');
  if (b === null || b === undefined) b = typeof a === 'number' ? 0 : (typeof a === 'boolean' ? false : '');
  return [a, b];
}

function typeRank(value) {
  if (typeof value === 'number') return 1;
  if (typeof value === 'string') return 2;
  if (typeof value === 'boolean') return 3;
  return 0;
}

function compareValues(left, right) {
  const [a, b] = comparisonParts(left, right);
  const rankA = typeRank(a);
  const rankB = typeRank(b);
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (lowerA === lowerB) return 0;
    return lowerA < lowerB ? -1 : 1;
  }
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// A number format from the file, for display and for TEXT().
function formatWithPattern(value, pattern) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return toText(value);
  const source = String(pattern || '').trim();
  if (!source || /^general$/i.test(source) || !/[0#]/.test(source)) return numberText(value);
  const clean = source.replace(/\\/g, '');
  const negative = value < 0;
  const absolute = Math.abs(value);
  const percent = clean.includes('%');
  const section = clean.split(';')[0] || '';
  const dot = section.indexOf('.');
  const decimalPart = dot === -1 ? '' : section.slice(dot + 1).replace(/[^0#]/g, '');
  const decimals = decimalPart.length;
  const grouped = /#,#|0,0/.test(section);
  const currency = /\$/.test(section);
  let number = percent ? absolute * 100 : absolute;
  let text = number.toFixed(decimals);
  if (grouped) {
    const [whole, fraction] = text.split('.');
    text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  }
  if (negative && Number(text.replace(/,/g, '')) !== 0) text = `-${text}`;
  if (currency) text = `$${text}`;
  if (percent) text += '%';
  return text;
}

// --- tokens --------------------------------------------------------------
const REF_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d+)/;
const ERROR_PATTERN = /^#(DIV\/0!|N\/A|VALUE!|NAME\?|REF!|NUM!|NULL!|CIRC!)/i;

function columnFromLetters(letters) {
  let column = 0;
  for (const character of letters.toUpperCase()) {
    column = column * 26 + (character.charCodeAt(0) - 64);
  }
  return column - 1;
}

function readReference(input, start) {
  const match = REF_PATTERN.exec(input.slice(start));
  if (!match) return null;
  return {
    column: columnFromLetters(match[1]),
    row: Number(match[2]) - 1,
    end: start + match[0].length
  };
}

function tokenize(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const character = input[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '"') {
      let text = '';
      index += 1;
      while (index < input.length) {
        if (input[index] === '"') {
          if (input[index + 1] === '"') {
            text += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        text += input[index];
        index += 1;
      }
      tokens.push({ type: 'string', value: text });
      continue;
    }
    const error = ERROR_PATTERN.exec(input.slice(index));
    if (error) {
      tokens.push({ type: 'error', value: error[0].toUpperCase() });
      index += error[0].length;
      continue;
    }
    const number = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(input.slice(index));
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    if (character === "'") {
      let position = index + 1;
      let name = '';
      while (position < input.length) {
        if (input[position] === "'") {
          if (input[position + 1] === "'") {
            name += "'";
            position += 2;
            continue;
          }
          break;
        }
        name += input[position];
        position += 1;
      }
      position += 1;
      if (input[position] !== '!') throw new ParseError('A sheet name needs a reference after it');
      const reference = readReference(input, position + 1);
      if (!reference) throw new ParseError('A sheet name needs a reference after it');
      tokens.push({ type: 'reference', sheet: name, ...reference });
      index = reference.end;
      continue;
    }
    if (character === '$' || /[A-Za-z_]/.test(character)) {
      const rest = input.slice(index);
      const sheet = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(rest);
      if (sheet) {
        const reference = readReference(input, index + sheet[0].length);
        if (!reference) throw new ParseError('A sheet name needs a reference after it');
        tokens.push({ type: 'reference', sheet: sheet[1], ...reference });
        index = reference.end;
        continue;
      }
      const call = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(rest);
      if (call) {
        tokens.push({ type: 'call', name: call[1].toUpperCase().replace(/^_XLFN\./, '') });
        index += call[0].length;
        continue;
      }
      const reference = readReference(input, index);
      if (reference) {
        tokens.push({ type: 'reference', sheet: null, ...reference });
        index = reference.end;
        continue;
      }
      const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
      if (!word) throw new ParseError('Unknown text in the formula');
      const upper = word[0].toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ type: 'boolean', value: upper === 'TRUE' });
      } else {
        throw new ParseError(`Unknown name ${word[0]}`);
      }
      index += word[0].length;
      continue;
    }
    if (character === '(' || character === ')' || character === ',' || character === ':') {
      tokens.push({ type: character });
      index += 1;
      continue;
    }
    const two = input.slice(index, index + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      tokens.push({ type: 'operator', value: two });
      index += 2;
      continue;
    }
    if ('+-*/^&=<>%'.includes(character)) {
      tokens.push({ type: 'operator', value: character });
      index += 1;
      continue;
    }
    throw new ParseError(`Unknown character ${character}`);
  }
  tokens.push({ type: 'end' });
  return tokens;
}

// --- parser --------------------------------------------------------------
function parseFormula(input) {
  const text = String(input).trim().replace(/^=/, '');
  const tokens = tokenize(text);
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const expect = (type) => {
    const token = next();
    if (token.type !== type) throw new ParseError(`Expected ${type}`);
    return token;
  };

  function expression() {
    return comparison();
  }

  function comparison() {
    let left = concatenation();
    while (peek().type === 'operator' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().value)) {
      const operator = next().value;
      left = { type: 'binary', operator, left, right: concatenation() };
    }
    return left;
  }

  function concatenation() {
    let left = addition();
    while (peek().type === 'operator' && peek().value === '&') {
      next();
      left = { type: 'binary', operator: '&', left, right: addition() };
    }
    return left;
  }

  function addition() {
    let left = multiplication();
    while (peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) {
      const operator = next().value;
      left = { type: 'binary', operator, left, right: multiplication() };
    }
    return left;
  }

  function multiplication() {
    let left = power();
    while (peek().type === 'operator' && (peek().value === '*' || peek().value === '/')) {
      const operator = next().value;
      left = { type: 'binary', operator, left, right: power() };
    }
    return left;
  }

  function power() {
    let left = unary();
    while (peek().type === 'operator' && peek().value === '^') {
      next();
      left = { type: 'binary', operator: '^', left, right: unary() };
    }
    return left;
  }

  function unary() {
    if (peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) {
      const operator = next().value;
      return { type: 'unary', operator, argument: unary() };
    }
    return postfix();
  }

  function postfix() {
    let value = primary();
    while (peek().type === 'operator' && peek().value === '%') {
      next();
      value = { type: 'percent', argument: value };
    }
    return value;
  }

  function primary() {
    const token = next();
    if (token.type === 'number' || token.type === 'string' || token.type === 'boolean') {
      return { type: token.type, value: token.value };
    }
    if (token.type === 'error') return { type: 'error', value: token.value };
    if (token.type === 'reference') {
      if (peek().type === ':') {
        next();
        const end = next();
        if (end.type !== 'reference') throw new ParseError('A range needs two references');
        return {
          type: 'range',
          sheet: token.sheet || end.sheet,
          startColumn: Math.min(token.column, end.column),
          startRow: Math.min(token.row, end.row),
          endColumn: Math.max(token.column, end.column),
          endRow: Math.max(token.row, end.row)
        };
      }
      return { type: 'reference', sheet: token.sheet, column: token.column, row: token.row };
    }
    if (token.type === 'call') {
      const args = [];
      if (peek().type !== ')') {
        args.push(expression());
        while (peek().type === ',') {
          next();
          args.push(expression());
        }
      }
      expect(')');
      return { type: 'call', name: token.name, args };
    }
    if (token.type === '(') {
      const inside = expression();
      expect(')');
      return inside;
    }
    throw new ParseError('That formula could not be read');
  }

  const tree = expression();
  if (peek().type !== 'end') throw new ParseError('That formula has extra text');
  return tree;
}

// --- the workbook --------------------------------------------------------
const EMPTY_SET = new Set();

// Positions of arguments that Excel always reads as ranges, even when the
// formula names a single cell there.
const RANGE_ARGUMENTS = {
  SUMIF: new Set([0, 2]),
  SUMIFS: new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]),
  COUNTIF: new Set([0]),
  COUNTIFS: new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]),
  VLOOKUP: new Set([1]),
  HLOOKUP: new Set([1]),
  INDEX: new Set([0]),
  MATCH: new Set([1])
};

function createWorkbook(sheets) {
  const byName = new Map();
  const values = new Map();
  const visiting = new Set();
  const trees = new Map();

  for (const sheet of sheets) {
    byName.set(String(sheet.name || '').trim().toLowerCase(), sheet);
  }

  function sheetFor(name) {
    if (!name) return null;
    return byName.get(String(name).trim().toLowerCase()) || null;
  }

  function keyOf(sheet, row, column) {
    return `${sheet.id}:${row}:${column}`;
  }

  function cellAt(sheet, row, column) {
    const rowValues = sheet.data[row];
    return rowValues ? rowValues[column] : undefined;
  }

  function valueOf(sheet, row, column) {
    if (!sheet) return errorValue('#REF!');
    if (row < 0 || column < 0) return errorValue('#REF!');
    const key = keyOf(sheet, row, column);
    if (values.has(key)) return values.get(key);
    const cell = cellAt(sheet, row, column);
    if (!cell) {
      values.set(key, null);
      return null;
    }
    if (!cell.f) {
      const raw = cell.v === undefined ? null : cell.v;
      values.set(key, raw);
      return raw;
    }
    if (visiting.has(key)) return errorValue('#CIRC!');
    visiting.add(key);
    let result;
    try {
      let tree = trees.get(key);
      if (!tree) {
        tree = parseFormula(cell.f);
        trees.set(key, tree);
      }
      result = evaluate(tree, sheet);
      if (isRange(result)) result = toScalar(result);
    } catch (error) {
      result = errorValue(error instanceof ParseError ? '#NAME?' : '#VALUE!');
    } finally {
      visiting.delete(key);
    }
    values.set(key, result);
    return result;
  }

  function rangeValue(node, sheet) {
    const target = node.sheet ? sheetFor(node.sheet) : sheet;
    if (!target) return errorValue('#REF!');
    const height = node.endRow - node.startRow + 1;
    const width = node.endColumn - node.startColumn + 1;
    if (height * width > MAX_RANGE_CELLS) return errorValue('#NUM!');
    const rows = [];
    for (let row = node.startRow; row <= node.endRow; row += 1) {
      const valuesRow = [];
      for (let column = node.startColumn; column <= node.endColumn; column += 1) {
        valuesRow.push(valueOf(target, row, column));
      }
      rows.push(valuesRow);
    }
    return new RangeValue(rows, target, node.startRow, node.startColumn);
  }

  function evaluate(node, sheet) {
    if (node.type === 'number' || node.type === 'string' || node.type === 'boolean') return node.value;
    if (node.type === 'error') return errorValue(node.value);
    if (node.type === 'reference') {
      const target = node.sheet ? sheetFor(node.sheet) : sheet;
      if (!target) return errorValue('#REF!');
      return valueOf(target, node.row, node.column);
    }
    if (node.type === 'range') return rangeValue(node, sheet);
    if (node.type === 'unary') {
      const value = toNumber(evaluate(node.argument, sheet));
      if (isError(value)) return value;
      return node.operator === '-' ? -value : value;
    }
    if (node.type === 'percent') {
      const value = toNumber(evaluate(node.argument, sheet));
      return isError(value) ? value : value / 100;
    }
    if (node.type === 'binary') {
      return binary(node.operator, evaluate(node.left, sheet), evaluate(node.right, sheet));
    }
    if (node.type === 'call') {
      // Some arguments are ranges even when they are written as one cell
      // (`SUMIF(A1:A4,"Art",B1)` stretches B1 over four rows).
      const rangeArguments = RANGE_ARGUMENTS[node.name] || EMPTY_SET;
      const args = node.args.map((argument, position) => {
        const value = evaluate(argument, sheet);
        if (!rangeArguments.has(position) || isRange(value)) return value;
        if (argument.type === 'reference') {
          const target = argument.sheet ? sheetFor(argument.sheet) : sheet;
          if (!target) return errorValue('#REF!');
          return new RangeValue([[value]], target, argument.row, argument.column);
        }
        return value;
      });
      return callFunction(node.name, args, { resolve: valueOf });
    }
    return errorValue('#VALUE!');
  }

  function binary(operator, left, right) {
    if (isRange(left) || isRange(right)) {
      const height = Math.max(isRange(left) ? left.rows.length : 1, isRange(right) ? right.rows.length : 1);
      let width = 1;
      for (const side of [left, right]) {
        if (!isRange(side)) continue;
        for (const row of side.rows) width = Math.max(width, row.length);
      }
      const rows = [];
      for (let row = 0; row < height; row += 1) {
        const valuesRow = [];
        for (let column = 0; column < width; column += 1) {
          const a = isRange(left) ? pick(left, row, column) : toScalar(left);
          const b = isRange(right) ? pick(right, row, column) : toScalar(right);
          valuesRow.push(binaryScalar(operator, a, b));
        }
        rows.push(valuesRow);
      }
      return new RangeValue(rows);
    }
    return binaryScalar(operator, left, right);
  }

  return { sheets, byName, valueOf, evaluate, sheetFor, values, trees };
}

function pick(range, row, column) {
  const valuesRow = range.rows[row];
  if (!valuesRow) return null;
  return column < valuesRow.length ? valuesRow[column] : null;
}

function binaryScalar(operator, left, right) {
  if (isError(left)) return left;
  if (isError(right)) return right;
  if (operator === '&') return toText(left) + toText(right);
  if (operator === '=') {
    if (typeof left === 'number' && typeof right === 'number') return left === right;
    return compareValues(left, right) === 0;
  }
  if (operator === '<>') {
    if (typeof left === 'number' && typeof right === 'number') return left !== right;
    return compareValues(left, right) !== 0;
  }
  if (operator === '<') return compareValues(left, right) < 0;
  if (operator === '>') return compareValues(left, right) > 0;
  if (operator === '<=') return compareValues(left, right) <= 0;
  if (operator === '>=') return compareValues(left, right) >= 0;

  const a = toNumber(left);
  if (isError(a)) return a;
  const b = toNumber(right);
  if (isError(b)) return b;
  if (operator === '+') return a + b;
  if (operator === '-') return a - b;
  if (operator === '*') return a * b;
  if (operator === '/') return b === 0 ? errorValue('#DIV/0!') : a / b;
  if (operator === '^') {
    const result = a ** b;
    return Number.isFinite(result) ? result : errorValue('#NUM!');
  }
  return errorValue('#VALUE!');
}

// --- criteria ------------------------------------------------------------
function wildcardRegex(text) {
  let pattern = '';
  for (const character of text) {
    if (character === '*') pattern += '.*';
    else if (character === '?') pattern += '.';
    else pattern += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`, 'i');
}

function criterionMatcher(criterion) {
  if (isError(criterion)) return () => criterion;
  if (typeof criterion === 'boolean') return (value) => value === criterion;
  if (typeof criterion === 'number') {
    return (value) => {
      if (typeof value === 'number') return value === criterion;
      if (typeof value === 'string' && value.trim() !== '') return Number(value) === criterion;
      return criterion === 0 && (value === null || value === undefined || value === '');
    };
  }
  const text = criterion === null || criterion === undefined ? '' : String(criterion);
  if (text === '') return (value) => value === null || value === undefined || value === '';
  const operatorMatch = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(text);
  const operator = operatorMatch ? operatorMatch[1] : '=';
  let operand = operatorMatch ? operatorMatch[2] : text;
  const numeric = operand.trim() !== '' && !Number.isNaN(Number(operand));
  if (numeric) operand = Number(operand);
  if (typeof operand === 'string' && /[*?]/.test(operand)) {
    const expression = wildcardRegex(operand);
    if (operator === '<>') return (value) => !expression.test(value === null || value === undefined ? '' : String(value));
    return (value) => expression.test(value === null || value === undefined ? '' : String(value));
  }
  if (numeric) {
    const wanted = Number(operand);
    return (value) => {
      let number;
      if (typeof value === 'number') number = value;
      else if (typeof value === 'string' && value.trim() !== '') number = Number(value);
      else if (value === null || value === undefined || value === '') number = 0;
      else number = Number.NaN;
      if (Number.isNaN(number)) return operator === '<>';
      if (operator === '=') return number === wanted;
      if (operator === '<>') return number !== wanted;
      if (operator === '<') return number < wanted;
      if (operator === '>') return number > wanted;
      if (operator === '<=') return number <= wanted;
      return number >= wanted;
    };
  }
  const wanted = operand.toLowerCase();
  return (value) => {
    if (value === null || value === undefined) {
      if (operator === '=') return wanted === '';
      if (operator === '<>') return wanted !== '';
      return false;
    }
    const actual = String(value).toLowerCase();
    if (operator === '=') return actual === wanted;
    if (operator === '<>') return actual !== wanted;
    if (operator === '<') return actual < wanted;
    if (operator === '>') return actual > wanted;
    if (operator === '<=') return actual <= wanted;
    return actual >= wanted;
  };
}

// --- functions -----------------------------------------------------------
function liftArguments(args, callback) {
  const shaped = args.find((argument) => isRange(argument));
  if (!shaped) return callback(args.map(toScalar));
  let width = 0;
  for (const row of shaped.rows) width = Math.max(width, row.length);
  const rows = [];
  for (let row = 0; row < shaped.rows.length; row += 1) {
    const valuesRow = [];
    for (let column = 0; column < width; column += 1) {
      valuesRow.push(callback(args.map((argument) => (isRange(argument) ? pick(argument, row, column) : toScalar(argument)))));
    }
    rows.push(valuesRow);
  }
  return new RangeValue(rows);
}

function lookupEquals(left, right) {
  const a = toScalar(left);
  const b = toScalar(right);
  if (a === null || a === undefined) return b === null || b === undefined || b === '' || b === 0;
  if (b === null || b === undefined) return a === '' || a === 0;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const numberA = typeof a === 'number' ? a : Number(String(a).trim());
    const numberB = typeof b === 'number' ? b : Number(String(b).trim());
    if (Number.isNaN(numberA) || Number.isNaN(numberB)) return false;
    return numberA === numberB;
  }
  return a === b;
}

function callFunction(name, args, helper) {
  switch (name) {
    case 'TRUE': return true;
    case 'FALSE': return false;
    case 'IF': {
      if (args.length < 2) return errorValue('#VALUE!');
      const condition = toBoolean(args[0]);
      if (isError(condition)) return condition;
      return condition ? args[1] : (args.length > 2 ? args[2] : false);
    }
    case 'IFERROR': {
      if (args.length < 2) return errorValue('#VALUE!');
      return isError(args[0]) ? args[1] : args[0];
    }
    case 'IFNA': {
      if (args.length < 2) return errorValue('#VALUE!');
      return isError(args[0]) && args[0].code === '#N/A' ? args[1] : args[0];
    }
    case 'OR': {
      let answer = false;
      for (const argument of args) {
        const value = toBoolean(argument);
        if (isError(value)) return value;
        if (value) answer = true;
      }
      return answer;
    }
    case 'AND': {
      let answer = true;
      for (const argument of args) {
        const value = toBoolean(argument);
        if (isError(value)) return value;
        if (!value) answer = false;
      }
      return answer;
    }
    case 'NOT': {
      const value = toBoolean(args[0]);
      return isError(value) ? value : !value;
    }
    case 'LEFT':
    case 'RIGHT':
    case 'MID':
    case 'LEN':
    case 'TRIM':
    case 'UPPER':
    case 'LOWER': {
      return liftArguments(args, (values) => {
        const text = toText(values[0]);
        if (isError(text)) return text;
        if (name === 'LEFT' || name === 'RIGHT') {
          const count = values.length > 1 ? toNumber(values[1]) : 1;
          if (isError(count)) return count;
          const length = Math.max(0, Math.trunc(count));
          return name === 'LEFT' ? text.slice(0, length) : text.slice(Math.max(0, text.length - length));
        }
        if (name === 'MID') {
          const start = toNumber(values[1]);
          const count = toNumber(values[2]);
          if (isError(start)) return start;
          if (isError(count)) return count;
          const from = Math.max(0, Math.trunc(start) - 1);
          return text.slice(from, from + Math.max(0, Math.trunc(count)));
        }
        if (name === 'LEN') return text.length;
        if (name === 'TRIM') return text.trim().replace(/\s+/g, ' ');
        if (name === 'UPPER') return text.toUpperCase();
        return text.toLowerCase();
      });
    }
    case 'CONCAT':
    case 'CONCATENATE': {
      let text = '';
      for (const argument of args) {
        const part = toText(argument);
        text += part;
      }
      return text;
    }
    case 'TEXT': {
      if (args.length < 2) return errorValue('#VALUE!');
      return formatWithPattern(toScalar(args[0]), toText(args[1]));
    }
    case 'SUM': {
      let total = 0;
      for (const argument of args) {
        if (isRange(argument)) {
          for (const row of argument.rows) {
            for (const cell of row) {
              if (isError(cell)) return cell;
              if (typeof cell === 'number') total += cell;
            }
          }
          continue;
        }
        if (isError(argument)) return argument;
        const number = toNumber(argument);
        if (isError(number)) return number;
        total += number;
      }
      return total;
    }
    case 'MIN':
    case 'MAX':
    case 'AVERAGE': {
      const numbers = [];
      for (const argument of args) {
        if (isRange(argument)) {
          for (const row of argument.rows) {
            for (const cell of row) {
              if (isError(cell)) return cell;
              if (typeof cell === 'number') numbers.push(cell);
            }
          }
          continue;
        }
        if (isError(argument)) return argument;
        const number = toNumber(argument);
        if (isError(number)) return number;
        numbers.push(number);
      }
      if (!numbers.length) return name === 'AVERAGE' ? errorValue('#DIV/0!') : 0;
      if (name === 'MIN') return Math.min(...numbers);
      if (name === 'MAX') return Math.max(...numbers);
      return numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
    }
    case 'COUNT':
    case 'COUNTA': {
      let count = 0;
      for (const argument of args) {
        if (isRange(argument)) {
          for (const row of argument.rows) {
            for (const cell of row) {
              if (name === 'COUNT' ? typeof cell === 'number' : (cell !== null && cell !== undefined && cell !== '')) count += 1;
            }
          }
        } else if (name === 'COUNT' ? typeof argument === 'number' : (argument !== null && argument !== undefined && argument !== '')) {
          count += 1;
        }
      }
      return count;
    }
    case 'COUNTIF': {
      const range = args[0];
      const criterion = args[1];
      if (!isRange(range)) return errorValue('#VALUE!');
      if (isRange(criterion)) {
        const rows = criterion.rows.map((row) => row.map((value) => {
          const test = criterionMatcher(value);
          let count = 0;
          for (const criterionRow of range.rows) {
            for (const cell of criterionRow) {
              if (test(cell)) count += 1;
            }
          }
          return count;
        }));
        return new RangeValue(rows);
      }
      const test = criterionMatcher(criterion);
      let count = 0;
      for (const row of range.rows) {
        for (const cell of row) {
          if (test(cell)) count += 1;
        }
      }
      return count;
    }
    case 'SUMIF': {
      const criteriaRange = args[0];
      if (!isRange(criteriaRange)) return errorValue('#VALUE!');
      const sumRange = isRange(args[2]) ? args[2] : criteriaRange;
      // A one-cell sum range stretches over the criteria range in Excel, so a
      // match sums the cell that sits at the same offset from the sum range's
      // top-left. That needs the original coordinates and the sheet itself.
      const stretches = sumRange.rows.length === 1 && (sumRange.rows[0] || []).length === 1 &&
        (criteriaRange.rows.length > 1 || Math.max(0, ...criteriaRange.rows.map((row) => row.length)) > 1);
      const sumCell = (row, column) => {
        if (!isRange(args[2])) return pick(criteriaRange, row, column);
        if (!stretches || !sumRange.sheet) return pick(sumRange, row, column);
        return helper.resolve(sumRange.sheet, sumRange.startRow + row, sumRange.startColumn + column);
      };
      const sumFor = (criterion) => {
        const test = criterionMatcher(criterion);
        let total = 0;
        for (let row = 0; row < criteriaRange.rows.length; row += 1) {
          const valuesRow = criteriaRange.rows[row];
          for (let column = 0; column < valuesRow.length; column += 1) {
            if (!test(valuesRow[column])) continue;
            const value = sumCell(row, column);
            if (isError(value)) return value;
            if (typeof value === 'number') total += value;
            else if (typeof value === 'boolean') total += value ? 1 : 0;
          }
        }
        return total;
      };
      const criterion = args[1];
      if (isRange(criterion)) {
        return new RangeValue(criterion.rows.map((row) => row.map((value) => sumFor(value))));
      }
      return sumFor(criterion);
    }
    case 'SUMPRODUCT': {
      if (!args.length) return errorValue('#VALUE!');
      const matrices = args.map((argument) => (isRange(argument) ? argument.rows : [[toScalar(argument)]]));
      let height = 1;
      let width = 1;
      for (const matrix of matrices) {
        height = Math.max(height, matrix.length);
        for (const row of matrix) width = Math.max(width, row.length);
      }
      let total = 0;
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          let product = 1;
          for (const matrix of matrices) {
            const single = matrix.length === 1 && matrix[0].length === 1;
            const value = single ? matrix[0][0] : (matrix[row] ? matrix[row][column] : null);
            if (isError(value)) return value;
            if (typeof value === 'number') product *= value;
            else if (typeof value === 'boolean') product *= value ? 1 : 0;
            else product *= 0;
          }
          total += product;
        }
      }
      return total;
    }
    case 'VLOOKUP':
    case 'HLOOKUP': {
      if (args.length < 3) return errorValue('#VALUE!');
      const needle = args[0];
      const table = args[1];
      if (!isRange(table)) return errorValue('#VALUE!');
      const index = toNumber(args[2]);
      if (isError(index)) return index;
      const approximate = args.length >= 4 ? toBoolean(args[3]) : true;
      if (isError(approximate)) return approximate;
      const lookupIndex = Math.trunc(index) - 1;
      if (lookupIndex < 0) return errorValue('#REF!');
      const vertical = name === 'VLOOKUP';
      const height = table.rows.length;
      const width = table.rows.reduce((max, row) => Math.max(max, row.length), 0);
      if (vertical ? lookupIndex >= width : lookupIndex >= height) return errorValue('#REF!');
      const count = vertical ? height : width;
      const head = (position) => (vertical ? pick(table, position, 0) : pick(table, 0, position));
      const result = (position) => (vertical ? pick(table, position, lookupIndex) : pick(table, lookupIndex, position));
      let found = -1;
      for (let position = 0; position < count; position += 1) {
        if (lookupEquals(head(position), needle)) {
          found = position;
          if (!approximate) break;
        }
      }
      if (approximate && found === -1) {
        // Sorted tables: the last row that is not greater than the value.
        for (let position = count - 1; position >= 0; position -= 1) {
          const cell = head(position);
          if (isError(cell)) continue;
          if (compareValues(cell, needle) <= 0) { found = position; break; }
        }
      }
      if (found === -1) return errorValue('#N/A');
      return result(found);
    }
    case 'ROUND':
    case 'ROUNDUP':
    case 'ROUNDDOWN': {
      const value = toNumber(args[0]);
      const digits = args.length > 1 ? toNumber(args[1]) : 0;
      if (isError(value)) return value;
      if (isError(digits)) return digits;
      if (name === 'ROUND') return Number(value.toFixed(Math.max(0, Math.min(15, Math.trunc(digits)))));
      const factor = 10 ** Math.trunc(digits);
      if (name === 'ROUNDUP') return Math.ceil(value * factor) / factor;
      return Math.floor(value * factor) / factor;
    }
    case 'ABS': {
      const value = toNumber(args[0]);
      return isError(value) ? value : Math.abs(value);
    }
    case 'INT': {
      const value = toNumber(args[0]);
      return isError(value) ? value : Math.floor(value);
    }
    case 'MOD': {
      const a = toNumber(args[0]);
      const b = toNumber(args[1]);
      if (isError(a)) return a;
      if (isError(b)) return b;
      return b === 0 ? errorValue('#DIV/0!') : a % b;
    }
    case 'ISBLANK': {
      const value = toScalar(args[0]);
      return value === null || value === undefined || value === '';
    }
    case 'ISNUMBER': return typeof toScalar(args[0]) === 'number';
    case 'ISTEXT': return typeof toScalar(args[0]) === 'string';
    case 'ISERROR': return isError(args[0]);
    case 'INDEX': {
      const table = args[0];
      if (!isRange(table)) return errorValue('#VALUE!');
      const row = args.length > 1 ? toNumber(args[1]) : 1;
      const column = args.length > 2 ? toNumber(args[2]) : 1;
      if (isError(row)) return row;
      if (isError(column)) return column;
      return pick(table, Math.trunc(row) - 1, Math.trunc(column) - 1);
    }
    case 'MATCH': {
      const needle = args[0];
      const table = args[1];
      if (!isRange(table)) return errorValue('#VALUE!');
      const row = table.rows[0] || [];
      for (let index = 0; index < row.length; index += 1) {
        if (lookupEquals(row[index], needle)) return index + 1;
      }
      return errorValue('#N/A');
    }
    default:
      return errorValue('#NAME?');
  }
}

// --- the public surface --------------------------------------------------
// Fill in every formula cell of every sheet. The formula stays, the answer
// takes the place of the old cached value.
function recalculate(sheets) {
  const copy = sheets.map((sheet, index) => ({
    ...sheet,
    id: sheet.id || `sheet-${index}`,
    data: (sheet.data || []).map((row) => (row || []).map((cell) => {
      if (cell === null || cell === undefined) return null;
      if (typeof cell !== 'object') return { v: cell, f: null };
      return { ...cell };
    }))
  }));
  const workbook = createWorkbook(copy);
  const stored = new Map();
  for (const sheet of copy) {
    for (let row = 0; row < sheet.data.length; row += 1) {
      const valuesRow = sheet.data[row];
      for (let column = 0; column < valuesRow.length; column += 1) {
        const cell = valuesRow[column];
        if (!cell || !cell.f) continue;
        stored.set(cell, workbook.valueOf(sheet, row, column));
      }
    }
  }
  // The values are written after every cell has been worked out, so formulas
  // that read each other settle in whatever order they are visited.
  for (const [cell, value] of stored) {
    const scalar = isRange(value) ? toScalar(value) : value;
    // Excel keeps an empty string in a formula that points at a blank cell.
    cell.v = isError(scalar) ? scalar.code : (scalar === undefined || scalar === null ? '' : scalar);
  }
  return copy;
}

// A formula typed into the app is stored without its leading "=".
function normalizeFormula(text) {
  return String(text || '').trim().replace(/^=/, '').slice(0, 2000);
}

module.exports = {
  recalculate,
  parseFormula,
  formatWithPattern,
  normalizeFormula,
  ERROR_CODES
};
