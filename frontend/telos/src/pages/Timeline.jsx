import { useEffect, useRef, useState } from 'react';
import { api, list } from '../api.js';
import { CollapseToggle, Empty, ErrorNote, Field, Modal, Panel, fmtDate, notify, useCollapsed, useSubmit } from '../ui.jsx';
import { Icon } from '../icons.jsx';

const DAY = 86400000;
/* A phone gets a narrower name column, taller rows and a zoom that stays
   readable instead of squeezing the whole plan into the screen. */
const WIDE_LABEL = 260;
const NARROW_LABEL = 162;
const WIDE_ROW = 40;
const NARROW_ROW = 48;
const isPhone = () => typeof window !== 'undefined' && window.innerWidth <= 720;

// Dates are handled as calendar day numbers, never as fixed milliseconds:
// a fixed number of milliseconds shifts the date when the clocks change.
const dayNumber = (value) => {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY);
};
const dateFromDay = (day) => new Date(day * DAY).toISOString().slice(0, 10);
// "Today" comes from the local calendar, not the UTC one: west of Greenwich
// the UTC date is already tomorrow for much of the local evening.
const todayDayNumber = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return dayNumber(`${now.getFullYear()}-${month}-${day}`);
};
// A short form for the narrow column: no year, no clutter. The day number is a
// UTC midnight, so format it as UTC: a local-time render shifts the date east
// of Greenwich (UTC+12/+14) as well as west.
const shortDate = (day) => new Date(day * DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

// How much of the timeline fits in the visible area.
const SCALES = [
  { key: 'fit', label: 'Fit', pixelsPerDay: null },
  { key: 'month', label: 'Month', pixelsPerDay: 14 },
  { key: 'quarter', label: 'Quarter', pixelsPerDay: 5 }
];

export default function Timeline({ state, projectId, onChange, canEdit = false }) {
  const tasks = list(state.data, 'tasks').filter((t) => t.start_date || t.end_date);
  const { toggle, isCollapsed } = useCollapsed();
  return (
    <Panel state={state} empty={tasks.length === 0 ? <Empty title="Nothing scheduled" mood="normal">Tasks with a start or end date appear here.</Empty> : null}>
      <Chart
        tasks={tasks}
        projectId={projectId}
        onChange={onChange}
        canEdit={canEdit}
        isCollapsed={isCollapsed}
        onToggle={toggle}
      />
    </Panel>
  );
}

function Chart({ tasks, projectId, onChange, canEdit, isCollapsed, onToggle }) {
  const [scale, setScale] = useState(() => (isPhone() ? 'quarter' : 'fit'));
  const [narrow, setNarrow] = useState(isPhone);
  const wrapRef = useRef(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  const [drag, setDrag] = useState(null);
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);
  const scrollRef = useRef(null);
  const [panning, setPanning] = useState(false);
  const [dateEditor, setDateEditor] = useState(null);

  const labelWidth = narrow ? NARROW_LABEL : WIDE_LABEL;
  const rowHeight = narrow ? NARROW_ROW : WIDE_ROW;

  useEffect(() => {
    const onResize = () => setNarrow(isPhone());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fitting the whole plan on a phone makes the bars invisible.
  useEffect(() => {
    if (narrow) setScale((current) => (current === 'fit' ? 'quarter' : current));
  }, [narrow]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => setWrapWidth(entries[0].contentRect.width));
    observer.observe(element);
    setWrapWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const rows = tasks.map((t) => ({
    ...t,
    s: dayNumber(t.start_date || t.end_date),
    e: dayNumber(t.end_date || t.start_date)
  }));

  // A wheel over the plan travels through time. The listener is native because
  // React registers wheel as passive, which would ignore preventDefault().
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      // The names column belongs to the page, and pinch-zoom is not ours either.
      if (event.ctrlKey || event.target.closest?.('.g-label')) return;
      const max = element.scrollWidth - element.clientWidth;
      if (max <= 0) return;
      const step = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * step;
      if (!delta) return;
      // At either edge, let the page take over instead of trapping the wheel.
      if ((element.scrollLeft <= 0 && delta < 0) || (element.scrollLeft >= max - 1 && delta > 0)) return;
      event.preventDefault();
      element.scrollLeft += delta;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [rows.length]);

  if (rows.length === 0) return null;

  const minDay = Math.min(...rows.map((r) => r.s));
  const maxDay = Math.max(...rows.map((r) => r.e));
  const days = Math.max(1, maxDay - minDay + 1);

  const available = Math.max(320, (wrapWidth || 1000) - labelWidth);
  const pixelsPerDay = scale === 'fit'
    ? Math.max(0.6, Math.min(22, available / days))
    : SCALES.find((option) => option.key === scale).pixelsPerDay;
  const planWidth = Math.max(320, days * pixelsPerDay);
  // When the plan fits, the track flexes to fill the sheet. Match that width
  // so the pixel-positioned arrows and today rail line up with the
  // percentage-positioned bars, ticks and ruling.
  const trackWidth = wrapWidth > 0 ? Math.max(planWidth, wrapWidth - labelWidth) : planWidth;
  const dayWidth = trackWidth / days;
  const canPan = wrapWidth > 0 && labelWidth + trackWidth > wrapWidth + 1;

  const pct = (day) => ((day - minDay) / days) * 100;

  // Subtasks are folded under their parent, at any depth.
  const nodes = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parent_task_id ? nodes.get(node.parent_task_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byStart = (a, b) => a.s - b.s || a.id - b.id;
  roots.sort(byStart);

  const ordered = [];
  const walk = (list, depth) => {
    for (const node of list) {
      node.children.sort(byStart);
      ordered.push({ ...node, depth });
      if (node.children.length && !isCollapsed(node.id)) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);

  const byId = new Map(ordered.map((row) => [row.id, row]));

  // --- rescheduling -------------------------------------------------------
  const beginDrag = (event, row, mode) => {
    if (!canEdit || row.is_milestone || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    try { event.currentTarget.setPointerCapture(pointerId); } catch { /* pointer may already be released */ }
    const startX = event.clientX;
    const original = { s: row.s, e: row.e };
    setDrag({ id: row.id, mode });

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const delta = Math.round((moveEvent.clientX - startX) / dayWidth);
      const next = mode === 'resize'
        ? { s: original.s, e: Math.max(original.s, original.e + delta) }
        : { s: original.s + delta, e: original.e + delta };
      previewRef.current = { id: row.id, ...next };
      setPreview(previewRef.current);
    };

    const cleanUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanUp();
      previewRef.current = null;
      setDrag(null);
      setPreview(null);
    };
    const onUp = async (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanUp();
      const moved = previewRef.current;
      previewRef.current = null;
      setDrag(null);
      setPreview(null);
      if (!moved) return;
      const newStart = dateFromDay(moved.s);
      const newEnd = dateFromDay(moved.e);
      if (newStart === dateFromDay(original.s) && newEnd === dateFromDay(original.e)) return;
      try {
        await api(`/projects/${projectId}/tasks/${row.id}`, {
          method: 'PATCH',
          body: { start_date: newStart, end_date: newEnd }
        });
        onChange();
        notify(`"${row.title}" moved to ${fmtDate(newStart)}`, {
          action: {
            label: 'Undo',
            onAction: async () => {
              await api(`/projects/${projectId}/tasks/${row.id}`, {
                method: 'PATCH',
                body: { start_date: dateFromDay(original.s), end_date: dateFromDay(original.e) }
              });
              onChange();
            }
          }
        });
      } catch (error) {
        notify(error.message || 'Could not move that task');
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // Dragging the empty track slides the plan sideways; bars keep their own drag.
  const beginPan = (event) => {
    if (event.button !== 0 || event.isPrimary === false || !canPan) return;
    if (event.target.closest('.g-label') || (canEdit && event.target.closest('.g-bar'))) return;
    const element = scrollRef.current;
    if (!element) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    try { event.currentTarget.setPointerCapture(pointerId); } catch { /* pointer may already be released */ }
    const startX = event.clientX;
    const startScrollLeft = element.scrollLeft;
    setPanning(true);

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      element.scrollLeft = startScrollLeft - (moveEvent.clientX - startX);
    };

    const cleanUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanUp();
      setPanning(false);
    };
    const onCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanUp();
      setPanning(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // Arrow keys walk the plan when the strip itself has focus.
  const onKeyDown = (event) => {
    if (event.target.closest?.('.g-label')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const element = scrollRef.current;
    if (!element || element.scrollWidth - element.clientWidth <= 0) return;
    event.preventDefault();
    const step = Math.max(80, element.clientWidth * 0.25);
    element.scrollLeft += event.key === 'ArrowLeft' ? -step : step;
  };

  const tickStep = pixelsPerDay >= 12 ? 7 : pixelsPerDay >= 5 ? 30 : 90;
  const ticks = [];
  for (let d = 0; d < days; d += tickStep) ticks.push(minDay + d);
  // The ruling on the track steps with the ticks, so the paper moves with the plan.
  const gridStep = Math.max(6, Math.round(tickStep * dayWidth));
  const todayDay = todayDayNumber();
  const todayVisible = todayDay >= minDay && todayDay <= maxDay;

  // Dependency arrows: from the end of a prerequisite to the start of the
  // task that waits for it.
  const rowIndex = new Map(ordered.map((row, index) => [row.id, index]));
  const arrows = [];
  for (const row of ordered) {
    for (const dependency of row.depends_on || []) {
      const from = byId.get(dependency);
      if (!from) continue;
      arrows.push({
        id: `${from.id}-${row.id}`,
        x1: labelWidth + ((from.e - minDay + 1) / days) * trackWidth,
        x2: labelWidth + ((row.s - minDay) / days) * trackWidth,
        y1: rowIndex.get(from.id) * rowHeight + rowHeight / 2,
        y2: rowIndex.get(row.id) * rowHeight + rowHeight / 2
      });
    }
  }

  return (
    <div className="gantt-wrap" ref={wrapRef}>
      <div className="gantt-toolbar">
        <span className="muted gantt-range">
          {fmtDate(dateFromDay(minDay))} – {fmtDate(dateFromDay(maxDay))}
          {todayVisible ? ' · today' : ''}
        </span>
        <div className="chips" role="group" aria-label="Timeline zoom">
          {SCALES.map((option) => (
            <button
              key={option.key}
              className={scale === option.key ? 'on' : ''}
              onClick={() => setScale(narrow && option.key === 'fit' ? 'quarter' : option.key)}
              disabled={narrow && option.key === 'fit'}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`gantt-scroll ${canPan ? 'can-pan' : ''} ${canEdit ? 'can-edit' : ''} ${panning ? 'panning' : ''}`}
        ref={scrollRef}
        tabIndex={canPan ? 0 : -1}
        role="region"
        aria-label="Project timeline"
        onKeyDown={onKeyDown}
      >
        <div
          className="gantt"
          style={{ minWidth: labelWidth + trackWidth, '--grid-step': `${gridStep}px` }}
          onPointerDown={beginPan}
        >
          <div className="g-row g-head">
            <div className="g-label" />
            <div className="g-track" style={canPan ? { cursor: panning ? 'grabbing' : 'grab' } : undefined}>
              {ticks.map((t) => (
                <span key={t} style={{ left: `${pct(t)}%` }}>
                  {shortDate(t)}
                </span>
              ))}
            </div>
          </div>
          <div className="gantt-body">
            {todayVisible && (
              <i className="now-rail" style={{ left: `${labelWidth + pct(todayDay) / 100 * trackWidth}px` }} />
            )}
            {arrows.length > 0 && (
              <svg className="gantt-arrows" width={labelWidth + trackWidth} height={ordered.length * rowHeight}>
                {arrows.map((arrow) => (
                  <path
                    key={arrow.id}
                    d={`M ${arrow.x1} ${arrow.y1} L ${arrow.x1 + 8} ${arrow.y1} L ${arrow.x1 + 8} ${arrow.y2} L ${arrow.x2} ${arrow.y2}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                ))}
              </svg>
            )}
            {ordered.map((row) => {
              const previewRow = preview && preview.id === row.id ? preview : null;
              const start = previewRow ? previewRow.s : row.s;
              const end = previewRow ? previewRow.e : row.e;
              const left = pct(start);
              const width = Math.max(0.6, ((end - start + 1) / days) * 100);
              return (
                <div key={row.id} className="g-row">
                  <div
                    className={`g-label ${row.depth > 0 ? 'sub' : ''} ${row.depth === 0 ? 'phase' : ''}`}
                    style={row.depth > 0 ? { '--depth': row.depth } : undefined}
                    title={row.title}
                  >
                    {row.children.length > 0 && (
                      <CollapseToggle
                        expanded={!isCollapsed(row.id)}
                        onToggle={() => onToggle(row.id)}
                        label={isCollapsed(row.id) ? `Show subtasks of ${row.title}` : `Hide subtasks of ${row.title}`}
                      />
                    )}
                    <span className="g-label-body">
                      <span className="g-label-text">{row.title}</span>
                      <span className="g-label-dates">
                        {shortDate(row.s)} – {shortDate(row.e)}
                      </span>
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className="g-date-edit"
                        aria-label={'Edit dates for ' + row.title}
                        title="Edit dates"
                        onClick={() => setDateEditor(row)}
                      >
                        <Icon name="calendar" size={14} />
                      </button>
                    )}
                  </div>
                  <div className="g-track">
                    {row.is_milestone ? (
                      <div className="g-milestone" style={{ left: `${left}%` }} title={`${row.title} — milestone`} />
                    ) : (
                      <div
                        className={`g-bar ${row.status} ${drag && drag.id === row.id ? 'dragging' : ''}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${row.title}: ${fmtDate(row.start_date)} – ${fmtDate(row.end_date)} (${row.progress}%)`}
                        onPointerDown={(event) => beginDrag(event, row, 'move')}
                      >
                        <b style={{ width: `${row.progress}%` }} />
                        {canEdit && (
                          <span
                            className="g-handle"
                            onPointerDown={(event) => beginDrag(event, row, 'resize')}
                            title="Drag to change the end date"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {arrows.length > 0 && (
        <p className="muted gantt-hint">
          {arrows.length} dependenc{arrows.length === 1 ? 'y' : 'ies'} between these tasks.
        </p>
      )}
      {narrow && canPan ? (
        <p className="muted gantt-hint">Swipe the plan sideways to travel through time.</p>
      ) : (
        <p className="muted gantt-hint">
          {canPan
            ? `Drag to pan, wheel to scroll, arrow keys to navigate${canEdit ? ', drag bars to reschedule' : ''}.`
            : canEdit
              ? 'Drag bars to reschedule.'
              : 'Zoom in to pan.'}
        </p>
      )}
      {dateEditor && (
        <TimelineDateEditor
          task={dateEditor}
          projectId={projectId}
          onClose={() => setDateEditor(null)}
          onSaved={() => { setDateEditor(null); onChange(); }}
        />
      )}
    </div>
  );
}

function TimelineDateEditor({ task, projectId, onClose, onSaved }) {
  const [start, setStart] = useState(task.start_date || '');
  const [end, setEnd] = useState(task.end_date || '');
  const { busy, error, submit, setError } = useSubmit();

  const save = (event) => {
    event.preventDefault();
    if (start && end && end < start) {
      setError({ message: 'End date cannot be before the start date.' });
      return;
    }
    submit(async () => {
      await api('/projects/' + projectId + '/tasks/' + task.id, {
        method: 'PATCH',
        body: { start_date: start || null, end_date: end || null }
      });
      notify('Dates saved for "' + task.title + '"');
      onSaved();
    });
  };

  return (
    <Modal title={'Edit dates: ' + task.title} onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted">Leave a date blank when the task has no date for that end.</p>
        <Field label="Start date">
          <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label="End date">
          <input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save dates'}</button>
        </footer>
      </form>
    </Modal>
  );
}
