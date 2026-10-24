import { useEffect, useMemo, useRef, useState } from 'react';
import { api, list } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../icons.jsx';
import { ask } from '../ui.jsx';
import {
  Badge, CollapseToggle, Empty, ErrorNote, Field, InlineDate, InlineNumber, InlineText,
  Modal, PRIORITY, Panel, Progress, STATUS, fmtDate, toDateInput, useCollapsed, useSubmit
} from '../ui.jsx';
import { priorityForWeight, statusForProgress, useRules, weightBand } from '../rules.js';
import { dueLabel, dueTitle, isNotable, scheduleMeta, scheduleState } from '../schedule.js';

export default function Tasks({
  projectId, state, members, onChange, onEdit, focusTask = null,
  canCreate = false, canUpdate = false, canManageTasks = false, canDelete = false
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // { task?, parent? }
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState(null);
  const [drag, setDrag] = useState(null);
  // The drag source lives in a ref: the first dragover happens before React
  // has re-rendered, and a drop is only allowed if that event is cancelled.
  const dragRef = useRef(null);
  const roots = list(state.data, 'data');
  const [tree, setTree] = useState(roots);
  const { toggle: toggleCollapsed, isCollapsed, setCollapsed: setCollapsedTo } = useCollapsed();
  const focusedRef = useRef(null);

  // Arriving from the attention view: open the way to the task and show it.
  useEffect(() => {
    if (!focusTask) return;
    if (focusedRef.current === focusTask) return;
    // Wait for the list to arrive before reaching for the row.
    const element = document.querySelector(`[data-task-id="${focusTask}"]`);
    if (!element) return;
    focusedRef.current = focusTask;
    const flat = flattenTree(tree || []);
    const ancestors = flat
      .find((node) => Number(node.id) === Number(focusTask))
      ?.parent_task_id;
    if (ancestors) setCollapsedTo((previous) => {
      const next = new Set(previous);
      let cursor = flat.find((node) => Number(node.id) === Number(ancestors));
      while (cursor) {
        next.delete(cursor.id);
        cursor = flat.find((node) => Number(node.id) === Number(cursor.parent_task_id));
      }
      return next;
    });
    element.scrollIntoView({ block: 'center' });
    element.classList.add('flash');
    const timer = setTimeout(() => element.classList.remove('flash'), 2600);
    return () => clearTimeout(timer);
  }, [focusTask, tree]);

  useEffect(() => { setTree(roots); }, [state.data]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (t) =>
      (status === 'all' || t.status === status) &&
      t.title.toLowerCase().includes(needle);
    return filterTree(tree || [], match);
  }, [tree, status, q]);

  const canEditTask = (task) => canManageTasks || (
    canUpdate && (task.assignees || []).some((assignee) => Number(assignee.id) === Number(user?.id))
  );

  // --- editing -------------------------------------------------------------
  const applyLocally = (nodes, id, patch) => nodes.map((node) => {
    if (Number(node.id) === Number(id)) return { ...node, ...patch };
    if (!node.subtasks || node.subtasks.length === 0) return node;
    return { ...node, subtasks: applyLocally(node.subtasks, id, patch) };
  });

  const patchTask = async (task, patch, note) => {
    const previous = tree;
    setTree(applyLocally(tree || [], task.id, patch));
    try {
      await api(`/projects/${projectId}/tasks/${task.id}`, { method: 'PATCH', body: patch });
      if (onEdit) onEdit(); else onChange();
      return true;
    } catch (error) {
      setTree(previous);
      throw error;
    }
  };

  const saveField = async (task, patch, note) => {
    try {
      await patchTask(task, patch, note);
    } catch (error) {
      // The message is shown by the row that asked for the change.
      // eslint-disable-next-line no-alert
      setRowError(error.message || 'Could not save');
    }
  };

  const [rowError, setRowError] = useState(null);
  const [cursor, setCursor] = useState(null);
  const searchRef = useRef(null);

  // The keyboard layer: new task, search, and moving through the list.
  useEffect(() => {
    const flat = flattenTree(visible);
    const onNew = () => { if (canCreate) setForm({}); };
    const onFocus = () => { searchRef.current?.focus(); };
    const step = (direction) => {
      if (!flat.length) return;
      const current = flat.findIndex((node) => node.id === cursor);
      const next = current < 0
        ? (direction > 0 ? 0 : flat.length - 1)
        : Math.min(flat.length - 1, Math.max(0, current + direction));
      setCursor(flat[next].id);
      const element = document.querySelector(`[data-task-id="${flat[next].id}"]`);
      element?.scrollIntoView({ block: 'nearest' });
    };
    const onEdit = () => {
      const node = flat.find((item) => item.id === cursor);
      if (node) setForm({ task: node });
    };
    const onNext = () => step(1);
    const onPrevious = () => step(-1);
    window.addEventListener('telos:new-task', onNew);
    window.addEventListener('telos:focus-search', onFocus);
    window.addEventListener('telos:next-task', onNext);
    window.addEventListener('telos:previous-task', onPrevious);
    window.addEventListener('telos:edit-task', onEdit);
    return () => {
      window.removeEventListener('telos:new-task', onNew);
      window.removeEventListener('telos:focus-search', onFocus);
      window.removeEventListener('telos:next-task', onNext);
      window.removeEventListener('telos:previous-task', onPrevious);
      window.removeEventListener('telos:edit-task', onEdit);
    };
  }, [visible, cursor, canCreate]);

  // --- selection -----------------------------------------------------------
  const toggleSelected = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const selectedIds = [...selected];

  // --- dragging ------------------------------------------------------------
  const canDrag = canManageTasks;

  const onDragStart = (event, node) => {
    if (!canDrag) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(node.id));
    dragRef.current = { id: node.id, over: null, position: null };
    setDrag(dragRef.current);

    // A drag can end anywhere, including on nothing at all, so the guide is
    // cleared by the document as well as by the row.
    const endDrag = () => {
      document.removeEventListener('dragend', endDrag);
      document.removeEventListener('mouseup', endDrag);
      dragRef.current = null;
      setDrag(null);
    };
    document.addEventListener('dragend', endDrag);
    document.addEventListener('mouseup', endDrag);
  };

  const onDragOver = (event, node) => {
    const current = dragRef.current;
    if (!current || !canDrag) return;
    if (Number(node.id) === Number(current.id)) return;
    if (isDescendant(tree, node.id, current.id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const position = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
    if (current.over !== node.id || current.position !== position) {
      dragRef.current = { ...current, over: node.id, position };
      setDrag(dragRef.current);
    }
  };

  const onDragEnd = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const onDrop = async (event, node, parent) => {
    const current = dragRef.current;
    if (!current || !canDrag) return;
    event.preventDefault();
    const source = findNode(tree, current.id);
    const target = findNode(tree, node.id);
    if (!source || !target) return;
    const position = current.position || 'inside';
    const nextParentId = position === 'inside' ? target.id : (parent ? parent.id : null);
    const siblings = nextParentId === null
      ? (tree || []).filter(item => Number(item.id) !== Number(source.id))
      : ((findNode(tree, nextParentId)?.subtasks) || []).filter(item => Number(item.id) !== Number(source.id));
    const targetIndex = siblings.findIndex(item => Number(item.id) === Number(target.id));
    let index = siblings.length;
    if (position === 'before' && targetIndex >= 0) index = targetIndex;
    if (position === 'after' && targetIndex >= 0) index = targetIndex + 1;
    if (position === 'inside') index = siblings.length;

    const previous = tree;
    const optimistic = moveInTree(tree, source.id, nextParentId, index);
    setTree(optimistic);
    dragRef.current = null;
    setDrag(null);
    try {
      await api(`/projects/${projectId}/tasks/${source.id}/move`, {
        method: 'PATCH',
        body: { parent_task_id: nextParentId, position: index }
      });
      if (onEdit) onEdit(); else onChange();
    } catch (error) {
      setTree(previous);
      setRowError(error.message || 'Could not move that task');
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter tasks by status">
          {[['all', 'All'], ...Object.entries(STATUS)].map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <div className="row">
          <input ref={searchRef} type="search" aria-label="Search tasks" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
          {canManageTasks && (
            <button
              className={`select-toggle ${selecting ? 'on' : ''}`}
              aria-pressed={selecting}
              onClick={() => { setSelecting((value) => !value); setSelected(new Set()); }}
            >
              <Icon name={selecting ? 'check' : 'square'} size={15} />
              {selecting ? 'Done' : 'Select'}
            </button>
          )}
          {canCreate && <button className="primary" onClick={() => setForm({})}>Add task</button>}
        </div>
      </div>

      {rowError && <ErrorNote error={{ message: rowError }} retry={() => setRowError(null)} />}

      <Panel state={state}>
        {visible.length === 0 ? (
          <Empty
            mood={roots.length ? 'normal' : 'happy'}
            title={roots.length ? 'No tasks match these filters' : 'No tasks yet'}
            action={roots.length
              ? <button onClick={() => { setStatus('all'); setQ(''); }}>Clear filters</button>
              : canCreate
                ? <button className="primary" onClick={() => setForm({})}>Add the first task</button>
                : null}
          >
            {roots.length
              ? 'Clear the search or status filter.'
              : canCreate
                ? 'Add a first task to start tracking progress.'
                : 'No tasks have been added to this project yet.'}
          </Empty>
        ) : (
          <div className="list">
            <TaskTree
              nodes={visible}
              depth={0}
              parentId={null}
              index={0}
              onOpen={(task) => setForm({ task })}
              onAddSub={(task) => setForm({ parent: task })}
              canEditTask={canEditTask}
              canCreate={canCreate}
              isCollapsed={isCollapsed}
              onToggle={toggleCollapsed}
              selecting={selecting}
              selected={selected}
              onSelect={toggleSelected}
              canDrag={canDrag}
              cursorId={cursor}
              drag={drag}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onSave={saveField}
              canInline={canManageTasks || canUpdate}
            />
          </div>
        )}
      </Panel>

      {selecting && selectedIds.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <strong>{selectedIds.length} selected</strong>
          <div className="row">
            <button className="primary" onClick={() => setBulk({ ids: selectedIds })}>Change selected</button>
            <button className="link" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      {bulk && (
        <BulkForm
          projectId={projectId}
          ids={bulk.ids}
          members={members}
          onClose={() => setBulk(null)}
          onSaved={() => { setBulk(null); setSelected(new Set()); if (onEdit) onEdit(); else onChange(); }}
        />
      )}

      {form && (
        <TaskForm
          projectId={projectId}
          members={members}
          siblings={flattenTree(tree || [])}
          {...form}
          canManageTasks={canManageTasks}
          canDelete={canDelete}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); onChange(); }}
        />
      )}
    </>
  );
}

function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (Number(node.id) === Number(id)) return node;
    const found = findNode(node.subtasks || [], id);
    if (found) return found;
  }
  return null;
}

// Is `maybeChild` inside the subtree of `ancestor`?
function isDescendant(nodes, maybeChild, ancestor) {
  const node = findNode(nodes, maybeChild);
  if (!node) return false;
  let cursor = node;
  const seen = new Set();
  while (cursor) {
    if (Number(cursor.id) === Number(ancestor)) return true;
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    cursor = cursor.parent_task_id ? findNode(nodes, cursor.parent_task_id) : null;
  }
  return false;
}

// Move a task to a new parent and position, in the local tree.
function moveInTree(nodes, id, parentId, index) {
  const source = findNode(nodes, id);
  if (!source) return nodes;
  const removed = removeFromTree(nodes, id);
  const working = removed.root;
  if (parentId === null) {
    working.splice(Math.min(index, working.length), 0, source);
    return working;
  }
  const parent = findNode(working, parentId);
  if (!parent) return working;
  parent.subtasks.splice(Math.min(index, parent.subtasks.length), 0, source);
  return working;
}

function removeFromTree(nodes, id) {
  const list = nodes.map(node => ({ ...node, subtasks: node.subtasks ? [...node.subtasks] : [] }));
  const index = list.findIndex(node => Number(node.id) === Number(id));
  if (index >= 0) {
    const [removed] = list.splice(index, 1);
    return { root: list, removed };
  }
  for (const node of list) {
    if (node.subtasks && node.subtasks.length) {
      const result = removeFromTree(node.subtasks, id);
      if (result.removed) {
        node.subtasks = result.root;
        return { root: list, removed: result.removed };
      }
    }
  }
  return { root: list, removed: null };
}

// Keeps a task when it matches, or when one of its children matches.
function filterTree(nodes, match) {
  const result = [];
  for (const node of nodes) {
    const children = filterTree(node.subtasks || [], match);
    if (match(node) || children.length > 0) {
      result.push({ ...node, subtasks: match(node) ? (node.subtasks || []) : children });
    }
  }
  return result;
}

function TaskTree({
  nodes, depth, parentId, index, onOpen, onAddSub, canEditTask, canCreate,
  isCollapsed, onToggle, selecting, selected, onSelect, canDrag, cursorId, drag,
  onDragStart, onDragOver, onDrop, onDragEnd, dropState, onSave, canInline
}) {
  return nodes.map((node, nodeIndex) => {
    const children = node.subtasks || [];
    const folded = children.length > 0 && isCollapsed(node.id);
    const isDropTarget = drag && drag.over === node.id;
    return (
      <div className="task-group" key={node.id}>
        <TaskRow
          t={node}
          depth={depth}
          parentId={parentId}
          cursor={cursorId === node.id}
          onOpen={() => onOpen(node)}
          onAddSub={() => onAddSub(node)}
          canEdit={canEditTask(node)}
          canCreate={canCreate}
          hasChildren={children.length > 0}
          folded={folded}
          onToggle={() => onToggle(node.id)}
          selecting={selecting}
          selected={selected.has(node.id)}
          onSelect={() => onSelect(node.id)}
          canDrag={canDrag}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          dropState={isDropTarget ? drag.position : null}
          onSave={onSave}
          canInline={canInline && canEditTask(node)}
        />
        {!folded && children.length > 0 && (
          <TaskTree
            nodes={children}
            depth={depth + 1}
            parentId={node.id}
            index={nodeIndex}
            onOpen={onOpen}
            onAddSub={onAddSub}
            canEditTask={canEditTask}
            canCreate={canCreate}
            isCollapsed={isCollapsed}
            onToggle={onToggle}
            selecting={selecting}
            selected={selected}
            onSelect={onSelect}
            canDrag={canDrag}
            cursorId={cursorId}
            drag={drag}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            onSave={onSave}
            canInline={canInline}
          />
        )}
      </div>
    );
  });
}

function TaskRow({
  t, depth, parentId, cursor, onOpen, onAddSub, canEdit, canCreate, hasChildren, folded, onToggle,
  selecting, selected, onSelect, canDrag, onDragStart, onDragOver, onDrop, onDragEnd, dropState, onSave, canInline
}) {
  const dates = t.start_date || t.end_date ? `${fmtDate(t.start_date) || '…'} – ${fmtDate(t.end_date) || '…'}` : 'No dates';
  const title = (
    <span className="task-head">
      {selecting && (
        <label className="task-select">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${t.title}`} />
        </label>
      )}
      {hasChildren && (
        <CollapseToggle
          expanded={!folded}
          onToggle={onToggle}
          label={folded ? `Show subtasks of ${t.title}` : `Hide subtasks of ${t.title}`}
        />
      )}
      {canInline ? (
        <InlineText
          className="task-title-input"
          value={t.title}
          label={`Rename ${t.title}`}
          onSave={(value) => onSave(t, { title: value })}
        />
      ) : (
        <span className="task-title">{t.title}</span>
      )}
      <Badge kind={t.status}>{STATUS[t.status] || STATUS.todo}</Badge>
      <Badge kind={`p-${t.priority}`}>{PRIORITY[t.priority] || PRIORITY.low}</Badge>
      {isNotable(t) && <span className={`chip chip-${scheduleState(t)}`}>{scheduleMeta(t).label}</span>}
      {t.blocked && t.blocked.length > 0 && <span className="chip chip-blocked">Blocked</span>}
      <span className="task-meta">
        <span className="muted">Weight {Number(t.weight ?? 0)}</span>
        {(t.assignees || []).length > 0 && (
          <span className="muted">{t.assignees.map((a) => a.name).join(', ')}</span>
        )}
      </span>
    </span>
  );

  const canNest = canCreate && t.is_subtask !== true && t.has_hidden_subtasks !== true;
  // A leaf task shows the same pencil bar as its parent, with the number
  // still editable in place.
  const progress = canInline && !(t.subtasks || []).length ? (
    <Progress
      value={t.progress}
      valueNode={(
        <InlineNumber
          className="task-progress-input"
          value={t.progress}
          max={100}
          suffix="%"
          label={`Progress for ${t.title}`}
          onSave={(value) => onSave(t, { progress: value })}
        />
      )}
    />
  ) : (
    <Progress value={t.progress} />
  );

  return (
    <div
      className={`task ${depth > 0 ? 'sub' : ''} ${cursor ? 'cursor' : ''} ${dropState ? `drop-${dropState}` : ''}`}
      data-task-id={t.id}
      style={depth > 0 ? { marginLeft: depth * 24 } : undefined}
      draggable={canDrag && t.is_subtask !== true}
      onDragStart={(event) => onDragStart(event, t)}
      onDragOver={(event) => onDragOver(event, t)}
      onDrop={(event) => onDrop(event, t, parentId)}
      onDragEnd={onDragEnd}
    >
      <div className="task-main">
        {title}
      </div>
      <span className="task-dates">
        {canInline ? (
          <>
            <InlineDate className="task-date" value={t.start_date} label={`Start date for ${t.title}`} onSave={(value) => onSave(t, { start_date: value })} />
            {' → '}
            <InlineDate className="task-date" value={t.end_date} label={`End date for ${t.title}`} onSave={(value) => onSave(t, { end_date: value })} />
          </>
        ) : (
          <span className="muted" title={dueTitle(t)}>{dueLabel(t) || dates}</span>
        )}
      </span>
      {progress}
      <span className="task-actions">
        {canEdit && <button type="button" className="link add-subtask" onClick={onOpen}>Edit</button>}
        {canNest && <button type="button" className="link add-subtask" onClick={onAddSub}>Add subtask</button>}
      </span>
    </div>
  );
}

function BulkForm({ projectId, ids, members, onClose, onSaved }) {
  const [f, setF] = useState({
    weight: '', progress: '', start_date: '', end_date: '', assignee_ids: null
  });
  const { busy, error, submit } = useSubmit();
  const { rules } = useRules();

  const toggleAssignee = (id) => {
    const current = f.assignee_ids || [];
    setF({
      ...f,
      assignee_ids: current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    });
  };

  const save = (e) => {
    e.preventDefault();
    const body = {};
    if (f.weight !== '') body.weight = Number(f.weight);
    if (f.progress !== '') body.progress = Number(f.progress);
    if (f.start_date !== '') body.start_date = f.start_date;
    if (f.end_date !== '') body.end_date = f.end_date;
    if (f.assignee_ids) body.assignee_ids = f.assignee_ids;
    if (Object.keys(body).length === 0) return;
    submit(async () => {
      await api(`/projects/${projectId}/tasks/bulk`, { method: 'PATCH', body: { ids, ...body } });
      onSaved();
    });
  };

  return (
    <Modal title={`Change ${ids.length} task${ids.length === 1 ? '' : 's'}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted">Only the fields you fill in are changed. Everything else is left alone.</p>
        <div className="two">
          <Field label="Weight" hint={rules ? `0 to ${rules.weight.max}` : ''}>
            <input type="number" min={0} max={rules?.weight?.max ?? 12} step={rules?.weight?.step ?? 0.5}
              value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} placeholder="Leave empty to keep" />
          </Field>
          <Field label="Progress (%)">
            <input type="number" min="0" max="100" step="1"
              value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value })} placeholder="Leave empty to keep" />
          </Field>
          <Field label="Start date">
            <input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
          </Field>
          <Field label="End date">
            <input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
          </Field>
        </div>
        <fieldset>
          <legend>Assignees</legend>
          <p className="muted">Leave empty to keep the current people.</p>
          {members.length === 0 ? <p className="muted">Add people on the Team tab first.</p> : (
            <div className="checks">
              {members.map((m) => (
                <label key={m.userId}>
                  <input type="checkbox" checked={(f.assignee_ids || []).includes(m.userId)} onChange={() => toggleAssignee(m.userId)} />
                  {m.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <ErrorNote error={error} />
        <footer>
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>Apply to {ids.length}</button>
        </footer>
      </form>
    </Modal>
  );
}

// The title of a task, so a prerequisite can be picked by name.
function titleOf(list, id) {
  const found = list.find((item) => Number(item.id) === Number(id));
  return found ? found.title : '';
}

function flattenTree(nodes) {
  const all = [];
  const walk = (list) => {
    for (const node of list) {
      all.push(node);
      walk(node.subtasks || []);
    }
  };
  walk(nodes || []);
  return all;
}

function TaskForm({ projectId, members, siblings = [], task, parent, onClose, onSaved, canManageTasks, canDelete }) {
  const editing = !!task;
  const progressOnly = editing && !canManageTasks;
  const hasSubs = editing && ((task.subtasks || []).length > 0 || task.has_hidden_subtasks === true);
  // The bands and thresholds come from the server, so the preview can never
  // disagree with what will be saved.
  const { rules } = useRules();
  const [f, setF] = useState({
    title: task?.title || '', description: task?.description || '',
    progress: task?.progress ?? 0, weight: Number(task?.weight ?? 1),
    start_date: toDateInput(task?.start_date), end_date: toDateInput(task?.end_date),
    assignee_ids: (task?.assignees || []).map((a) => a.id),
    is_milestone: !!task?.is_milestone,
    depends_on_title: (task?.depends_on || [])[0] ? titleOf(siblings, task.depends_on[0]) : ''
  });
  const { busy, error, submit, setError } = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (id) => setF({ ...f, assignee_ids: f.assignee_ids.includes(id) ? f.assignee_ids.filter((x) => x !== id) : [...f.assignee_ids, id] });

  const weight = Number(f.weight);
  const band = weightBand(rules, weight);
  const derivedStatus = statusForProgress(rules, f.progress);
  const derivedPriority = priorityForWeight(rules, weight);
  const weightMin = rules?.weight?.min ?? 0;
  const weightMax = rules?.weight?.max ?? 12;
  const weightStep = rules?.weight?.step ?? 0.5;

  const validate = () => {
    const p = Number(f.progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) return 'Progress must be a whole number from 0 to 100.';
    if (progressOnly) return null;
    if (!f.title.trim()) return 'Title is required.';
    if (!Number.isFinite(weight) || weight < weightMin || weight > weightMax) {
      return `Weight must be a number from ${weightMin} to ${weightMax}.`;
    }
    if (f.start_date && f.end_date && f.end_date < f.start_date) return 'End date cannot be before the start date.';
    return null;
  };

  const save = (e) => {
    e.preventDefault();
    if (progressOnly && hasSubs) return setError(new Error('Progress for this task is calculated from its subtasks.'));
    const problem = validate();
    if (problem) return setError(new Error(problem));
    const body = progressOnly
      ? { progress: Number(f.progress) }
      : {
        title: f.title.trim(), description: f.description.trim() || null,
        start_date: f.start_date || null, end_date: f.end_date || null,
        assignee_ids: f.assignee_ids,
        is_milestone: f.is_milestone
      };
    // A task with subtasks is fully derived, so weight and progress are not sent.
    if (!progressOnly && !hasSubs) {
      body.weight = Number(f.weight);
      body.progress = Number(f.progress);
    }
    if (!editing && parent) body.parent_task_id = parent.id;
    submit(async () => {
      const saved = await api(`/projects/${projectId}/tasks${editing ? `/${task.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body });
      if (editing && canManageTasks) {
        const match = siblings.find((item) => item.title === f.depends_on_title.trim());
        const wanted = match ? [match.id] : [];
        const current = (task.depends_on || []).map(Number);
        if (wanted.length !== current.length || wanted[0] !== current[0]) {
          await api(`/projects/${projectId}/tasks/${task.id}/dependencies`, {
            method: 'PUT',
            body: { depends_on: wanted }
          });
        }
      }
      onSaved();
    });
  };

  const remove = async () => {
    // Spell out exactly what goes with the task, so a parent with a subtree
    // cannot be deleted by accident.
    const descendants = [];
    const collect = (nodes) => {
      for (const node of nodes) {
        descendants.push(node);
        collect(node.subtasks || []);
      }
    };
    collect(task.subtasks || []);
    const count = descendants.length;
    const message = count
      ? `Delete "${task.title}" and its ${count} subtask${count === 1 ? '' : 's'}? Their progress and assignments are lost too. This cannot be undone.`
      : `Delete "${task.title}"? Its progress and assignments are lost too. This cannot be undone.`;
    const detail = descendants.slice(0, 8).map(node => node.title);
    if (count > 8) detail.push(`…and ${count - 8} more`);
    if (!(await ask(message, 'Delete', detail))) return;
    submit(async () => { await api(`/projects/${projectId}/tasks/${task.id}`, { method: 'DELETE' }); onSaved(); });
  };

  return (
    <Modal title={editing ? (progressOnly ? 'Update progress' : 'Edit task') : parent ? `New subtask of "${parent.title}"` : 'New task'} onClose={onClose}>
      <form onSubmit={save}>
        {progressOnly ? (
          <>
            <p className="muted">You can update progress for tasks assigned to you. Other task details are managed by the project team.</p>
            <div className="card">
              <strong>{task.title}</strong>
              {task.description && <p className="muted">{task.description}</p>}
            </div>
            <Field label="Progress (%)" hint={hasSubs ? 'Calculated from subtasks.' : undefined}>
              <input autoFocus type="number" min="0" max="100" step="1" disabled={hasSubs} value={f.progress} onChange={set('progress')} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Title"><input autoFocus value={f.title} onChange={set('title')} /></Field>
            <Field label="Description"><textarea rows={3} value={f.description} onChange={set('description')} /></Field>
            <div className="two">
              <Field label="Start date"><input type="date" value={f.start_date} onChange={set('start_date')} /></Field>
              <Field label="End date"><input type="date" value={f.end_date} onChange={set('end_date')} /></Field>
              <Field label="Progress (%)" hint={hasSubs ? 'Calculated from subtasks.' : undefined}>
                <input type="number" min="0" max="100" step="1" disabled={hasSubs} value={f.progress} onChange={set('progress')} />
              </Field>
              <Field
                label="Weight"
                hint={hasSubs
                  ? 'Calculated from subtasks.'
                  : band
                    ? `Weight ${weight} gives ${PRIORITY[band.priority].toLowerCase()} priority (band ${band.min}–${band.max}).`
                    : 'Weight decides the priority.'}
              >
                <input
                  type="number"
                  min={weightMin}
                  max={weightMax}
                  step={weightStep}
                  disabled={hasSubs}
                  value={f.weight}
                  onChange={set('weight')}
                />
              </Field>
            </div>
            <p className="muted derived-note">
              Status: <strong>{STATUS[derivedStatus]}</strong> · Priority: <strong>{PRIORITY[derivedPriority]}</strong>
              {hasSubs ? ' · calculated from subtasks' : ''}
            </p>
            <div className="two">
              <Field label="Milestone" hint="Shown as a diamond on the timeline.">
                <label className="check-line">
                  <input type="checkbox" checked={f.is_milestone} onChange={(e) => setF({ ...f, is_milestone: e.target.checked })} />
                  This task is a milestone
                </label>
              </Field>
              <Field label="Depends on" hint="What has to be finished first.">
                <input
                  list="depends-on-options"
                  value={f.depends_on_title}
                  placeholder="Nothing"
                  onChange={(e) => setF({ ...f, depends_on_title: e.target.value })}
                />
                <datalist id="depends-on-options">
                  {siblings
                    .filter((item) => !editing || item.id !== task.id)
                    .map((item) => <option key={item.id} value={item.title} />)}
                </datalist>
              </Field>
            </div>
            <fieldset>
              <legend>Assignees</legend>
              {members.length === 0 ? <p className="muted">Add people on the Team tab first.</p> : (
                <div className="checks">
                  {members.map((m) => (
                    <label key={m.userId}><input type="checkbox" checked={f.assignee_ids.includes(m.userId)} onChange={() => toggle(m.userId)} /> {m.name}</label>
                  ))}
                </div>
              )}
            </fieldset>
          </>
        )}
        <ErrorNote error={error} />
        <footer>
          {editing && canDelete && <button type="button" className="danger" onClick={remove} disabled={busy}>Delete</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || (progressOnly && hasSubs)}>{editing ? 'Save changes' : 'Add task'}</button>
        </footer>
      </form>
    </Modal>
  );
}
