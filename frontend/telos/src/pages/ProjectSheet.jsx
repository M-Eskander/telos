import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, list } from '../api.js';
import { Empty, ErrorNote, Loading, notify, tabKeyDown, useAsync } from '../ui.jsx';

const ERROR_CODES = new Set([
  '#DIV/0!', '#N/A', '#VALUE!', '#NAME?', '#REF!', '#NUM!', '#NULL!', '#CIRC!'
]);

const DEFAULT_COLUMN_WIDTH = 92;
const DEFAULT_ROW_HEIGHT = 31;
const ROW_HEADER_WIDTH = 42;

const columnLabel = (index) => {
  let label = '';
  let number = index + 1;
  while (number > 0) {
    const remainder = (number - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    number = Math.floor((number - 1) / 26);
  }
  return label;
};

const plainNumber = (value) => {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(15)));
};

// The same number formats the server writes back into the workbook, so a value
// looks in the app the way it will look in Excel.
const formatNumber = (value, pattern) => {
  const source = String(pattern || '').trim();
  if (!source || /^general$/i.test(source) || !/[0#]/.test(source)) return plainNumber(value);
  const clean = source.replace(/\\/g, '');
  const section = clean.split(';')[0] || '';
  const percent = clean.includes('%');
  const currency = clean.includes('$');
  const grouped = /[0#],[0#]/.test(section);
  const point = section.indexOf('.');
  const decimals = point === -1 ? 0 : (section.slice(point + 1).match(/[0#]/g) || []).length;
  const negative = value < 0;
  const scaled = percent ? Math.abs(value) * 100 : Math.abs(value);
  let text = scaled.toFixed(decimals);
  if (grouped) {
    const [whole, fraction] = text.split('.');
    text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  }
  if (negative && Number(text.replace(/,/g, '')) !== 0) text = `-${text}`;
  if (currency) text = `$${text}`;
  if (percent) text += '%';
  return text;
};

const isErrorCell = (cell) => typeof cell?.v === 'string' && ERROR_CODES.has(cell.v);

const displayValue = (cell) => {
  if (!cell || cell.pending) return cell?.pending ? '…' : '';
  const value = cell.v;
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return cell.z ? formatNumber(value, cell.z) : plainNumber(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
};

const rawText = (cell) => {
  if (!cell) return '';
  if (cell.f) return `=${cell.f}`;
  return cell.v === null || cell.v === undefined ? '' : String(cell.v);
};

const normalizeRows = (data) => (data || []).map((row) => (row || []).map((cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell !== 'object') return { v: cell, f: null };
  const next = { v: cell.v === undefined ? null : cell.v, f: cell.f || null };
  if (cell.z) next.z = cell.z;
  if (cell.s && typeof cell.s === 'object') next.s = cell.s;
  return next;
}));

// What the person typed becomes a value, a number, or a formula with no "=".
// The workbook's look belongs to the cell, not to what is typed in it, so a
// style and number format survive an edit.
const parseInput = (raw, previous) => {
  const text = String(raw ?? '');
  const keep = {};
  if (previous?.z) keep.z = previous.z;
  if (previous?.s) keep.s = previous.s;
  if (text === '' || text === '=') return { v: null, f: null, ...keep };
  if (text.startsWith('=')) return { v: null, f: text.slice(1), ...keep };
  const trimmed = text.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)%$/.test(trimmed)) {
    return { v: Number(trimmed.slice(0, -1)) / 100, f: null, ...keep };
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return { v: Number(trimmed), f: null, ...keep };
  }
  return { v: text, f: null, ...keep };
};

const withCell = (grid, rowIndex, columnIndex, next) => {
  const copy = grid.map((row) => row.slice());
  while (copy.length <= rowIndex) copy.push([]);
  while (copy[rowIndex].length <= columnIndex) copy[rowIndex].push(null);
  copy[rowIndex][columnIndex] = next;
  return copy;
};

const serializeCell = (cell) => {
  const stored = { v: cell?.v === undefined ? null : cell.v, f: cell?.f || null };
  if (cell?.z) stored.z = cell.z;
  if (cell?.s) stored.s = cell.s;
  return stored;
};

// Trailing empty rows and columns are not worth storing. This also removes the
// local "pending" marker before the grid travels to the server.
const trimGrid = (grid) => {
  let lastRow = grid.length - 1;
  const holdsSomething = (cell) => Boolean(cell && (cell.f || (cell.v !== null && cell.v !== undefined && cell.v !== '')));
  while (lastRow >= 0) {
    if ((grid[lastRow] || []).some(holdsSomething)) break;
    lastRow -= 1;
  }
  return grid.slice(0, lastRow + 1).map((row) => {
    let width = row.length;
    while (width > 0 && !holdsSomething(row[width - 1])) width -= 1;
    return row.slice(0, width).map((cell) => (holdsSomething(cell) || cell?.z || cell?.s ? serializeCell(cell) : null));
  });
};

const borderValue = (side) => {
  if (!side) return null;
  if (typeof side === 'object') return { color: side.c || 'cccccc', width: Number(side.w) > 1 ? 2 : 1 };
  return { color: side, width: 1 };
};

// The cell's paper: fills and rules. Text properties go on the button so the
// app's paper typography is kept while the workbook's colours come through.
const cellBoxStyle = (cell) => {
  const style = cell?.s;
  if (!style) return undefined;
  const box = {};
  if (style.fill) box.background = `#${style.fill}`;
  if (style.bd) {
    for (const side of ['t', 'r', 'b', 'l']) {
      const border = borderValue(style.bd[side]);
      if (!border) continue;
      box[`border${side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left'}`] =
        `${border.width}px solid #${border.color}`;
    }
  }
  return box;
};

const cellTextStyle = (cell) => {
  const style = cell?.s;
  if (!style) return undefined;
  const text = {};
  if (style.b) text.fontWeight = 600;
  if (style.i) text.fontStyle = 'italic';
  if (style.u) text.textDecoration = 'underline';
  if (style.sz) text.fontSize = `${Math.round(Number(style.sz) * 4 / 3)}px`;
  if (style.c) text.color = `#${style.c}`;
  if (style.a) text.textAlign = style.a;
  return text;
};

const alignOf = (cell) => {
  if (cell?.s?.a === 'center') return 'center';
  if (cell?.s?.a === 'right') return 'right';
  if (typeof cell?.v === 'number') return 'right';
  return 'left';
};

const verticalOf = (cell) => {
  if (cell?.s?.va === 'top') return 'flex-start';
  if (cell?.s?.va === 'middle') return 'center';
  return 'center';
};

// The spreadsheet of a project: the revenue share calculator lives here.
// Every edit is worked out by the same engine the server uses, saved quietly,
// and the answers on all the other sheets come back with it.
export default function ProjectSheet({ projectId, canEdit = false }) {
  const navigate = useNavigate();
  const state = useAsync(() => api(`/projects/${projectId}/sheets`), [projectId]);
  const sheets = list(state.data, 'sheets');
  const [activeId, setActiveId] = useState(null);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState(null);
  const [importWarnings, setImportWarnings] = useState([]);
  const cache = useRef(new Map());
  const rowsRef = useRef([]);
  const queue = useRef(Promise.resolve());
  const ticket = useRef(0);
  const ignoreBlur = useRef(false);
  const gridRef = useRef(null);
  const activeIdRef = useRef(null);

  const active = useMemo(
    () => sheets.find((sheet) => sheet.id === activeId) || sheets[0] || null,
    [sheets, activeId]
  );
  const sheetTabKeys = sheets.map((sheet) => String(sheet.id));
  const selectSheetTab = (id) => {
    const sheet = sheets.find((item) => String(item.id) === id);
    if (sheet) setActiveId(sheet.id);
  };

  const applyRows = (next) => {
    rowsRef.current = next;
    setRows(next);
  };

  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
    if (!active) {
      applyRows([]);
      return;
    }
    applyRows(normalizeRows(cache.current.get(active.id) ?? active.data));
    setSelected(null);
    setEditing(null);
    setSaveState('idle');
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.updated_at, version]);

  useEffect(() => {
    if (!selected || editing) return;
    const node = gridRef.current?.querySelector(`[data-cell="${selected.row}:${selected.col}"]`);
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected?.row, selected?.col, editing]);

  const meta = active?.meta || {};
  const dataWidth = rows.reduce((widest, row) => Math.max(widest, (row || []).length), 0);
  const width = Math.max(dataWidth, 6, Array.isArray(meta.cols) ? meta.cols.length : 0);
  const ghostRows = 5;
  const displayRows = useMemo(() => [...rows, ...Array.from({ length: ghostRows }, () => [])], [rows]);
  const formulaCount = useMemo(
    () => rows.reduce((count, row) => count + (row || []).filter((cell) => cell?.f).length, 0),
    [rows]
  );

  const columnWidth = (columnIndex) => {
    const imported = Number(meta.cols?.[columnIndex]);
    return imported > 0 ? Math.round(imported) : DEFAULT_COLUMN_WIDTH;
  };
  const rowHeight = (rowIndex) => {
    const imported = Number(meta.rows?.[rowIndex]);
    return imported > 0 ? Math.round(imported) : null;
  };
  const freezeColumns = Math.max(0, Math.min(Number(meta.freeze?.c) || 0, width));
  const freezeRowCount = Math.max(0, Math.min(Number(meta.freeze?.r) || 0, rows.length));
  const stickyHeaderRow = freezeRowCount > 0 ? freezeRowCount - 1 : -1;
  const columnOffsets = useMemo(() => {
    const offsets = [ROW_HEADER_WIDTH];
    for (let index = 0; index < width; index += 1) {
      offsets.push(offsets[index] + columnWidth(index));
    }
    return offsets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.cols, width]);

  const mergeLayout = useMemo(() => {
    const starts = new Map();
    const covered = new Set();
    for (const merge of meta.merges || []) {
      if (!merge?.s || !merge?.e) continue;
      const endRow = Math.min(merge.e.r, displayRows.length - 1);
      const endColumn = Math.min(merge.e.c, width - 1);
      if (endRow < merge.s.r || endColumn < merge.s.c) continue;
      starts.set(`${merge.s.r}:${merge.s.c}`, {
        rowSpan: endRow - merge.s.r + 1,
        colSpan: endColumn - merge.s.c + 1
      });
      for (let row = merge.s.r; row <= endRow; row += 1) {
        for (let column = merge.s.c; column <= endColumn; column += 1) {
          if (row !== merge.s.r || column !== merge.s.c) covered.add(`${row}:${column}`);
        }
      }
    }
    return { starts, covered };
  }, [meta.merges, displayRows.length, width]);

  const clampRow = (rowIndex) => Math.min(Math.max(rowIndex, 0), Math.max(displayRows.length - 1, 0));
  const clampColumn = (columnIndex) => Math.min(Math.max(columnIndex, 0), Math.max(width - 1, 0));

  const persist = (sheetId, sheetName, grid, sheetMeta) => {
    const current = ++ticket.current;
    setSaveState('saving');
    setSaveError(null);
    queue.current = queue.current.catch(() => {}).then(async () => {
      const result = await api(`/projects/${projectId}/sheets/${sheetId}`, {
        method: 'PUT',
        body: { name: sheetName, data: trimGrid(grid), meta: sheetMeta || null }
      });
      const returned = list(result, 'sheets');
      for (const sheet of returned) cache.current.set(sheet.id, normalizeRows(sheet.data));
      const saved = normalizeRows(result?.sheet?.data ?? trimGrid(grid));
      cache.current.set(sheetId, saved);
      if (current === ticket.current) {
        if (activeIdRef.current === sheetId) applyRows(saved);
        setSaveState('saved');
      }
    }).catch((error) => {
      if (current === ticket.current) {
        setSaveState('error');
        setSaveError(error);
      }
    });
  };

  const commitCell = (rowIndex, columnIndex, text) => {
    if (!canEdit || !active) return;
    const previous = rowsRef.current[rowIndex]?.[columnIndex] || null;
    if (rawText(previous) === text) return;
    const next = parseInput(text, previous);
    if (next.f) next.pending = true;
    const updated = withCell(rowsRef.current, rowIndex, columnIndex, next);
    applyRows(updated);
    setSaveState('saving');
    persist(active.id, active.name, updated, active.meta);
  };

  const startEdit = (rowIndex, columnIndex, seed) => {
    if (!canEdit) return;
    const cell = rowsRef.current[rowIndex]?.[columnIndex] || null;
    setSelected({ row: rowIndex, col: columnIndex });
    setDraft(seed !== undefined ? seed : rawText(cell));
    setEditing({ row: rowIndex, col: columnIndex });
  };

  const moveSelection = (rowDelta, columnDelta) => {
    setSelected((current) => {
      const origin = current || { row: 0, col: 0 };
      return {
        row: clampRow(origin.row + rowDelta),
        col: clampColumn(origin.col + columnDelta)
      };
    });
  };

  const finishEdit = (text, rowDelta = 0, columnDelta = 0, refocus = true) => {
    if (!editing) return;
    const { row, col } = editing;
    ignoreBlur.current = true;
    setEditing(null);
    commitCell(row, col, text);
    setSelected({ row: clampRow(row + rowDelta), col: clampColumn(col + columnDelta) });
    window.setTimeout(() => {
      ignoreBlur.current = false;
      if (refocus) gridRef.current?.focus();
    }, 30);
  };

  const cancelEdit = () => {
    ignoreBlur.current = true;
    setEditing(null);
    window.setTimeout(() => {
      ignoreBlur.current = false;
      gridRef.current?.focus();
    }, 30);
  };

  const onGridKeyDown = (event) => {
    if (!selected) return;
    if (event.target?.tagName === 'INPUT') return;
    const { row, col } = selected;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1, 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1, 0);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveSelection(0, -1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveSelection(0, 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSelected({ row, col: 0 });
    } else if (event.key === 'End') {
      event.preventDefault();
      setSelected({ row, col: width - 1 });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      startEdit(row, col);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (canEdit) commitCell(row, col, '');
    } else if (event.key === 'F2') {
      event.preventDefault();
      startEdit(row, col);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && canEdit) {
      event.preventDefault();
      startEdit(row, col, event.key);
    }
  };

  const importFile = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append('sheet', file);
    try {
      const result = await api(`/projects/${projectId}/sheets/import`, { method: 'POST', form });
      setImportWarnings(Array.isArray(result?.warnings) ? result.warnings : []);
      notify('Spreadsheet imported');
      cache.current.clear();
      setActiveId(null);
      setVersion((current) => current + 1);
      state.reload();
    } catch (error) {
      notify(error.message || 'Could not read that spreadsheet');
    }
  };

  if (state.loading && !state.data) return <Loading label="Opening the sheet…" />;
  if (state.error) return <ErrorNote error={state.error} retry={state.reload} />;

  const selectedCell = selected ? rows[selected.row]?.[selected.col] || null : null;
  const selectedAddress = selected ? `${columnLabel(selected.col)}${selected.row + 1}` : '';
  const barValue = rawText(selectedCell);
  const warnings = [...new Set([
    ...(Array.isArray(importWarnings) ? importWarnings : []),
    ...(Array.isArray(active?.meta?.truncated) ? active.meta.truncated : [])
  ])];

  const overflowing = (rowIndex, columnIndex, cell) => {
    const text = displayValue(cell);
    if (!text || !cell || typeof cell.v !== 'string' || cell.s?.wrap) return false;
    if ((cell.s?.a || 'left') !== 'left') return false;
    let available = columnWidth(columnIndex);
    for (let column = columnIndex + 1; column < width; column += 1) {
      const other = rows[rowIndex]?.[column];
      const holds = other && (other.f || (other.v !== null && other.v !== undefined && other.v !== ''));
      if (holds) break;
      available += columnWidth(column);
      if (available > 900) break;
    }
    const size = Number(cell.s?.sz) || 11;
    const charWidth = 7.2 * (size / 11) * (cell.s?.b ? 1.06 : 1);
    return text.length * charWidth + 14 <= available;
  };

  return (
    <div className="sheet-wrap">
      <div className="page-head section-head sheet-head">
        <div className="chips" role="tablist" aria-label="Sheets">
          {sheets.map((sheet) => (
            <button
              key={sheet.id}
              id={'sheet-tab-' + sheet.id}
              role="tab"
              aria-controls="sheet-panel"
              aria-selected={active?.id === sheet.id}
              tabIndex={active?.id === sheet.id ? 0 : -1}
              className={active?.id === sheet.id ? 'on' : ''}
              onClick={() => setActiveId(sheet.id)}
              onKeyDown={(event) => tabKeyDown(event, sheetTabKeys, String(active?.id ?? ''), selectSheetTab)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          {canEdit && sheets.length > 0 && (
            <button
              type="button"
              className="button-like"
              onClick={() => navigate(`/projects/${projectId}/sheet/editor`)}
              title="Open this workbook in the full ONLYOFFICE editor"
            >
              Open editor
            </button>
          )}
          {canEdit && (
            <label className="button-like" title="Import a spreadsheet">
              Import
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => importFile(event.target.files[0])} />
            </label>
          )}
          <a className="button-like" href={`/api/projects/${projectId}/sheets/export`} download title="Export with formulas and number formats">
            Export
          </a>
        </div>
      </div>

      {sheets.length === 0 ? (
        <Empty title="No spreadsheet yet" mood="happy">
          {canEdit
            ? 'Import the revenue share calculator and it becomes the source for this project’s contracts.'
            : 'The studio has not put a spreadsheet in this project yet.'}
        </Empty>
      ) : (
        <div id="sheet-panel" role="tabpanel" aria-labelledby={'sheet-tab-' + active.id} tabIndex={0}>
          <p className="muted sheet-note">
            {active?.source_name ? `From ${active.source_name}. ` : ''}
            {formulaCount > 0 ? `${formulaCount} formulas recalculate as you edit. ` : ''}
            Every change saves on its own, and Export keeps the formulas and number formats.
          </p>
          {warnings.length > 0 && (
            <div className="sheet-warning" role="alert">
              <strong>This file was too large for the quick grid, so the import was shortened.</strong>
              <ul>
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
              <span>Open the original file or the full editor for the complete sheet.</span>
            </div>
          )}
          <ErrorNote error={saveError} />

          <div className="sheet-bar">
            <span className="sheet-address" aria-label="Selected cell">{selectedAddress || '—'}</span>
            <input
              key={`${selectedAddress}-${barValue}`}
              defaultValue={barValue}
              placeholder={selected ? 'Type a value, or start a formula with =' : 'Pick a cell to edit it'}
              aria-label="Cell content"
              disabled={!canEdit || !selected || Boolean(editing)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (selected) commitCell(selected.row, selected.col, event.currentTarget.value);
                  gridRef.current?.focus();
                } else if (event.key === 'Escape') {
                  event.currentTarget.value = barValue;
                  event.currentTarget.blur();
                }
              }}
            />
            {canEdit && (
              <span className={`save-note ${saveState}`} role="status" aria-live="polite">
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : ''}
              </span>
            )}
          </div>

          <div className="sheet-legend" aria-hidden="true">
            <span><i className="swatch formula" />calculated</span>
            <span><i className="swatch input" />you type here</span>
            {stickyHeaderRow >= 0 && <span>The heading and the Name column stay in view.</span>}
          </div>

          <div
            className="sheet-scroll"
            ref={gridRef}
            tabIndex={-1}
            role="region"
            aria-label={active?.name || 'Spreadsheet'}
            onKeyDown={onGridKeyDown}
          >
            <table className="sheet-grid">
              <colgroup>
                <col style={{ width: `${ROW_HEADER_WIDTH}px` }} />
                {Array.from({ length: width }).map((_, columnIndex) => (
                  <col key={columnIndex} style={{ width: `${columnWidth(columnIndex)}px` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="sheet-corner" scope="col"><span className="sr-only">Row</span></th>
                  {Array.from({ length: width }).map((_, columnIndex) => (
                    <th
                      key={columnIndex}
                      className={`sheet-column${columnIndex < freezeColumns ? ' sticky-column-head' : ''}`}
                      scope="col"
                      style={columnIndex < freezeColumns ? { left: `${columnOffsets[columnIndex]}px` } : undefined}
                    >
                      {columnLabel(columnIndex)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, rowIndex) => {
                  const height = rowHeight(rowIndex);
                  const isStickyRow = rowIndex === stickyHeaderRow;
                  return (
                    <tr
                      key={rowIndex}
                      className={height && height < 28 ? 'tight' : undefined}
                      style={height ? { height: `${height}px` } : undefined}
                    >
                      <th
                        className={`sheet-row-number${isStickyRow ? ' sticky-row' : ''}`}
                        scope="row"
                        style={isStickyRow ? { top: '26px' } : undefined}
                      >
                        {rowIndex + 1}
                      </th>
                      {Array.from({ length: width }).map((_, columnIndex) => {
                        const cellKey = `${rowIndex}:${columnIndex}`;
                        if (mergeLayout.covered.has(cellKey)) return null;
                        const merge = mergeLayout.starts.get(cellKey);
                        const cell = row?.[columnIndex] || null;
                        const isEditing = editing?.row === rowIndex && editing?.col === columnIndex;
                        const isSelected = selected?.row === rowIndex && selected?.col === columnIndex;
                        const isStickyColumn = columnIndex < freezeColumns;
                        const classes = [
                          cell?.f ? 'has-formula' : '',
                          isSelected ? 'selected' : '',
                          isErrorCell(cell) ? 'error' : '',
                          cell?.pending ? 'pending' : '',
                          typeof cell?.v === 'number' ? 'num' : '',
                          isStickyRow ? 'sticky-row' : '',
                          isStickyColumn ? 'sticky-col' : '',
                          overflowing(rowIndex, columnIndex, cell) ? 'overflow-cell' : ''
                        ].filter(Boolean).join(' ');
                        const boxStyle = cellBoxStyle(cell);
                        const textStyle = cellTextStyle(cell);
                        const stickyStyle = isStickyColumn ? { left: `${columnOffsets[columnIndex]}px` } : {};
                        return (
                          <td
                            key={columnIndex}
                            colSpan={merge?.colSpan}
                            rowSpan={merge?.rowSpan}
                            className={classes}
                            style={{ ...boxStyle, ...stickyStyle }}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                className="sheet-cell-input"
                                value={draft}
                                aria-label={`Cell ${columnLabel(columnIndex)}${rowIndex + 1}`}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    finishEdit(draft, event.shiftKey ? -1 : 1, 0);
                                  } else if (event.key === 'Tab') {
                                    event.preventDefault();
                                    finishEdit(draft, 0, event.shiftKey ? -1 : 1);
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelEdit();
                                  }
                                }}
                                onBlur={() => {
                                  if (!ignoreBlur.current) finishEdit(draft, 0, 0, false);
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                data-cell={cellKey}
                                tabIndex={isSelected ? 0 : -1}
                                title={cell?.f ? `=${cell.f}` : undefined}
                                aria-label={`${columnLabel(columnIndex)}${rowIndex + 1}${displayValue(cell) ? `: ${displayValue(cell)}` : ', empty'}${cell?.f ? '. Formula' : ''}`}
                                className={[
                                  cell?.s?.wrap ? 'wrap' : '',
                                  overflowing(rowIndex, columnIndex, cell) ? 'overflowing' : ''
                                ].filter(Boolean).join(' ')}
                                style={{
                                  ...textStyle,
                                  justifyContent: alignOf(cell) === 'right' ? 'flex-end' : alignOf(cell) === 'center' ? 'center' : 'flex-start',
                                  alignItems: verticalOf(cell)
                                }}
                                onClick={() => {
                                  if (canEdit && isSelected) startEdit(rowIndex, columnIndex);
                                  else setSelected({ row: rowIndex, col: columnIndex });
                                }}
                                onDoubleClick={() => startEdit(rowIndex, columnIndex)}
                              >
                                <span className="sheet-cell-text">{displayValue(cell)}</span>
                                {cell?.f ? <span className="sheet-formula-mark" aria-hidden="true">ƒ</span> : null}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted sheet-hint">
            Click to select, click again or press Enter to edit. Scroll inside the sheet for more rows and columns.
            Cells marked ƒ carry formulas; red is an error the sheet could not work out.
          </p>
        </div>
      )}
    </div>
  );
}
