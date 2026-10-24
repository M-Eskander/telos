import { useEffect, useState, useCallback, useId, useRef } from 'react';
import { Icon } from './icons.jsx';
import { moodImage } from './mascot.js';

// Keeps the browser tab useful when several Telos pages are open.
export function PageTitle({ children }) {
  useEffect(() => {
    document.title = children ? `${children} · Telos` : 'Telos';
  }, [children]);
  return null;
}

// Let ARIA tablists support the expected arrow, Home, and End key movement.
export function tabKeyDown(event, keys, activeKey, onChange) {
  if (!keys.length) return;
  const current = Math.max(0, keys.indexOf(activeKey));
  let next = current;
  if (event.key === 'ArrowRight') next = (current + 1) % keys.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + keys.length) % keys.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = keys.length - 1;
  else return;
  event.preventDefault();
  const tabs = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]');
  tabs?.[next]?.focus();
  onChange(keys[next]);
}

// A small arrow that folds a group of subtasks away.
export function CollapseToggle({ expanded, onToggle, label }) {
  return (
    <button
      type="button"
      className={`collapse-toggle ${expanded ? 'open' : ''}`}
      aria-expanded={expanded}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
    >
      <Icon name="chevron" size={14} strokeWidth={2} />
    </button>
  );
}

// Tracks which groups are folded away.
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (id) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const isCollapsed = (id) => collapsed.has(id);
  return { collapsed, toggle, isCollapsed, setCollapsed };
}

export function useAsync(fn, deps = []) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    let live = true;
    setS((p) => ({ ...p, loading: true, error: null }));
    fn().then((data) => live && setS({ data, error: null, loading: false }))
        .catch((error) => live && setS({ data: null, error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => run(), [run]);
  return { ...s, reload: run };
}

// Like useAsync, but only fetches while `enabled` is true and keeps whatever
// was loaded before, so a page can load just the section that is on screen.
export function useAsyncIf(fn, deps = [], enabled = true) {
  const [s, setS] = useState({ data: null, error: null, loading: enabled });
  const run = useCallback(() => {
    if (!enabled) return undefined;
    let live = true;
    setS((p) => ({ ...p, loading: true, error: null }));
    fn().then((data) => live && setS({ data, error: null, loading: false }))
        .catch((error) => live && setS({ data: null, error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  useEffect(() => { run(); }, [run]);
  return { ...s, reload: run };
}

export const errText = (e) => {
  // A 403 is not always a permissions problem: signing in before verifying
  // your email is also a 403, and that reason must be shown verbatim.
  if (e?.code === 'EMAIL_NOT_VERIFIED') {
    return e?.message || 'Please verify your email address before signing in.';
  }
  return e?.status === 403 ? "You don't have access to this." : e?.message || 'Something went wrong.';
};

export function ErrorNote({ error, retry }) {
  if (!error) return null;
  return (
    <div className="note error" role="alert">
      <span>{errText(error)}</span>
      {retry && error.status !== 403 && <button className="link" onClick={retry}>Try again</button>}
    </div>
  );
}

export const Loading = ({ label = 'Loading…' }) => (
  <p className="muted pad loading" role="status">
    <span className="spinner" aria-hidden="true" />
    {label}
  </p>
);

export const Empty = ({ title, children, action, className = '', mood = 'normal' }) => (
  <div className={`empty ${className}`.trim()}>
    <img className="empty-mascot" src={moodImage(mood)} alt="" aria-hidden="true" />
    <strong>{title}</strong>
    {children && <p>{children}</p>}
    {action && <div className="empty-action">{action}</div>}
  </div>
);

export function Panel({ state, children, empty }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorNote error={state.error} retry={state.reload} />;
  return empty ? empty : children;
}

// Tracks open modals so Escape and Tab only affect the topmost one.
const modalStack = [];
// Dialogs overlap (a task form with a confirmation on top), so the scroll
// lock is counted rather than captured: the page is only released when the
// last dialog closes, whichever order they close in.
let scrollLocks = 0;
function lockScroll() {
  scrollLocks += 1;
  document.body.style.overflow = 'hidden';
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = '';
}

export function Modal({ title, onClose, children, wide, extraWide, layer = 'default' }) {
  const box = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  // Captured during render, before the dialog content takes focus, so focus can
  // be returned to whatever opened the dialog.
  const previousFocus = useRef(typeof document === 'undefined' ? null : document.activeElement);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = box.current;
    if (!node) return undefined;

    const token = Symbol('modal');
    modalStack.push(token);

    lockScroll();

    // Prefer the first form field; React's autoFocus wins when it already ran.
    if (!node.contains(document.activeElement)) {
      const preferred = node.querySelector(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]'
      );
      (preferred || node).focus();
    }

    const focusable = () => Array.from(node.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));

    const onKey = (e) => {
      // A confirm dialog can sit on top of a form dialog; only the top one reacts.
      if (modalStack[modalStack.length - 1] !== token) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!node.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const index = modalStack.indexOf(token);
      if (index >= 0) modalStack.splice(index, 1);
      unlockScroll();
      const target = previousFocus.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    };
  }, []);

  return (
    <div className={`overlay overlay-${layer}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'wide' : ''} ${extraWide ? 'extra-wide' : ''}`}
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

// Password input with a show/hide toggle. Accepts the same props as <input>.
export function PasswordField({ label, hint, ...props }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input id={id} type={show ? 'text' : 'password'} {...props} />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShow((value) => !value)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Progress({ value = 0, valueNode = null }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progress: ${v}%`}
      title={`${v}%`}
    >
      <div className="bar"><div style={{ width: `${v}%` }} /></div>{valueNode || <span>{v}%</span>}
    </div>
  );
}

export const STATUS = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
export const PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const Badge = ({ kind, children }) => <span className={`badge ${kind}`}>{children}</span>;

// is_active may arrive as true/false or 1/0 depending on the database driver.
export const isActive = (v) => !(v === false || v === 0 || v === '0' || v === 'false');

export const fmtDate = (d) =>
  d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const toDateInput = (d) => (d ? String(d).slice(0, 10) : '');

export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  };
  return { busy, error, submit, setError };
}

let askImpl = null;
// A short message that can offer one action, such as undo.
let toastImpl = null;
export const notify = (message, options = {}) =>
  new Promise((resolve) => {
    if (!toastImpl) { resolve(false); return; }
    toastImpl({ message, ...options, resolve });
  });

export function Toaster() {
  const [req, setReq] = useState(null);
  useEffect(() => { toastImpl = setReq; return () => { toastImpl = null; }; }, []);
  useEffect(() => {
    if (!req) return undefined;
    const timer = setTimeout(() => { req.resolve(false); setReq(null); }, req.duration || 6000);
    return () => clearTimeout(timer);
  }, [req]);
  if (!req) return null;
  const done = (value) => { req.resolve(value); setReq(null); };
  return (
    <div className="toaster" role="status" aria-live="polite">
      <span>{req.message}</span>
      {req.action && (
        <button
          type="button"
          className="link"
          onClick={async () => {
            if (req.action.onAction) await req.action.onAction();
            done(true);
          }}
        >
          {req.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => done(false)}>×</button>
    </div>
  );
}

// Editing a value in place, without opening a dialog.
export function InlineText({ value, onSave, className = '', placeholder = 'Add a title', label }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-edit ${className}`}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          setDraft(value || '');
          setEditing(true);
        }}
      >
        {value || <span className="muted">{placeholder}</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      className={`inline-input ${className}`}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { setEditing(false); if (draft !== (value || '')) onSave(draft); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { setDraft(value || ''); setEditing(false); }
      }}
    />
  );
}

export function InlineNumber({ value, onSave, className = '', min = 0, max = 100, step = 1, label, suffix = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? 0);
  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-edit ${className}`}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          setDraft(value ?? 0);
          setEditing(true);
        }}
      >
        {value}{suffix}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      className={`inline-input ${className}`}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { setEditing(false); if (Number(draft) !== Number(value)) onSave(Number(draft)); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { setDraft(value ?? 0); setEditing(false); }
      }}
    />
  );
}

export function InlineDate({ value, onSave, className = '', label }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(toDateInput(value));
  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-edit ${className}`}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          setDraft(toDateInput(value));
          setEditing(true);
        }}
      >
        {value ? fmtDate(value) : <span className="muted">Set date</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="date"
      className={`inline-input ${className}`}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { setEditing(false); if (draft !== toDateInput(value)) onSave(draft || null); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { setDraft(toDateInput(value)); setEditing(false); }
      }}
    />
  );
}

export const ask = (message, confirmLabel = 'Confirm', detail = null) =>
  new Promise((res) => (askImpl ? askImpl({ message, confirmLabel, detail, res }) : res(window.confirm(message))));

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  useEffect(() => { askImpl = setReq; return () => { askImpl = null; }; }, []);
  if (!req) return null;
  const done = (v) => { req.res(v); setReq(null); };
  return (
    <Modal title="Are you sure?" layer="confirm" onClose={() => done(false)}>
      <p>{req.message}</p>
      {req.detail && req.detail.length > 0 && (
        <ul className="confirm-list">
          {req.detail.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ul>
      )}
      <footer><button type="button" onClick={() => done(false)}>Cancel</button><button type="button" className="danger" autoFocus onClick={() => done(true)}>{req.confirmLabel}</button></footer>
    </Modal>
  );
}
