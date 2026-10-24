import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, list } from './api.js';
import { useAuth } from './auth.jsx';
import { Icon } from './icons.jsx';
import { can } from './permissions.js';
import { Modal } from './ui.jsx';

const SHORTCUTS = [
  { keys: ['⌘', 'K'], what: 'Open the command palette' },
  { keys: ['/'], what: 'Search the current list' },
  { keys: ['n'], what: 'New task' },
  { keys: ['j'], what: 'Next task' },
  { keys: ['k'], what: 'Previous task' },
  { keys: ['e'], what: 'Edit the selected task' },
  { keys: ['?'], what: 'Show this list' },
  { keys: ['Esc'], what: 'Close anything open' }
];

export function CommandPalette({ open, onClose, onNewTask }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // The palette lives outside the routes, so the project comes from the path.
  const projectId = (location.pathname.match(/^\/projects\/(\d+)/) || [])[1] || null;
  const inProjectPage = /^\/projects\/\d+$/.test(location.pathname);
  const requestedTab = new URLSearchParams(location.search).get('tab') || 'tasks';
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [index, setIndex] = useState(0);
  const project = projects.find((item) => String(item.id) === projectId) || null;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    api('/projects').then((response) => setProjects(list(response, 'projects'))).catch(() => {});
    if (projectId) {
      api(`/projects/${projectId}/tasks`)
        .then((response) => setTasks(flatten(list(response, 'data'))))
        .catch(() => {});
    }
  }, [open, projectId]);

  const commands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = [];
    const projectTabs = project ? [
      ['tasks', 'Tasks', can(project, 'read:task')],
      ['attention', 'Attention', can(project, 'read:task')],
      ['timeline', 'Timeline', can(project, 'read:task') && (user?.isOwner === true || !can(project, 'view_own:task'))],
      ['team', 'Team', can(project, 'read:team')],
      ['work', 'Work', can(project, 'read:team')],
      ['sheet', 'Sheet', can(project, 'read:project')],
      ['contracts', 'Contracts', can(project, 'read:project')],
      ['meetings', 'Meetings', can(project, 'read:project')],
      ['settings', 'Settings', can(project, 'update:project') || can(project, 'delete:project')]
    ].filter(([, , visible]) => visible) : [];
    const currentTab = projectTabs.some(([key]) => key === requestedTab)
      ? requestedTab
      : projectTabs[0]?.[0];

    for (const project of projects) {
      items.push({
        group: 'Projects',
        label: project.name,
        hint: project.summary ? `${project.summary.finished || 0}/${project.summary.total || 0} done` : '',
        run: () => navigate(`/projects/${project.id}`)
      });
    }

    if (projectId && project) {
      for (const [key, label] of projectTabs) {
        items.push({
          group: 'Go to',
          label: 'This project: ' + label,
          run: () => navigate('/projects/' + projectId + '?tab=' + key)
        });
      }
    }

    for (const task of tasks) {
      items.push({
        group: 'Tasks',
        label: task.title,
        hint: task.schedule ? task.schedule.state.replace('_', ' ') : '',
        run: () => navigate('/projects/' + projectId + '?tab=tasks&task=' + task.id)
      });
    }

    if (user?.isOwner) {
      items.push({ group: 'Go to', label: 'People', run: () => navigate('/people') });
      items.push({ group: 'Go to', label: 'Roles & access', run: () => navigate('/access') });
    }
    items.push({ group: 'Go to', label: 'Account', run: () => navigate('/account') });
    if (inProjectPage && project && currentTab === 'tasks' && can(project, 'create:task')) {
      items.push({
        group: 'Actions',
        label: 'New task',
        run: () => { onNewTask(); }
      });
    }

    if (!needle) return items.slice(0, 12);
    return items
      .filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [query, projects, tasks, projectId, inProjectPage, requestedTab, navigate, user, onNewTask, project]);

  useEffect(() => { setIndex(0); }, [query]);

  if (!open) return null;

  const run = (item) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <Modal title="Command palette" onClose={onClose} wide>
      <input
        autoFocus
        className="command-input"
        placeholder="Jump to a project, a task, or an action…"
        value={query}
        aria-label="Command"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((i) => Math.min(i + 1, commands.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
          if (event.key === 'Enter') { event.preventDefault(); run(commands[index]); }
        }}
      />
      <div className="command-list">
        {commands.length === 0 && <p className="muted">Nothing matches that.</p>}
        {commands.map((item, itemIndex) => (
          <button
            key={`${item.group}-${item.label}`}
            type="button"
            className={`command-item ${itemIndex === index ? 'on' : ''}`}
            onMouseEnter={() => setIndex(itemIndex)}
            onClick={() => run(item)}
          >
            <span className="command-group">{item.group}</span>
            <span className="command-label">{item.label}</span>
            {item.hint && <span className="muted command-hint">{item.hint}</span>}
          </button>
        ))}
      </div>
      <p className="muted command-foot">
        <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>↵</kbd> to open · <kbd>Esc</kbd> to close
      </p>
    </Modal>
  );
}

export function ShortcutSheet({ open, onClose }) {
  if (!open) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <ul className="shortcut-list">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.what}>
            <span className="shortcut-keys">
              {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
            </span>
            <span>{shortcut.what}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// The global keyboard layer.
export function useShortcuts({ onNewTask, onFocusSearch, onNext, onPrevious, onEdit }) {
  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      const typing = target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      );
      if (event.key === 'Escape') return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('telos:command'));
        return;
      }
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); onFocusSearch?.(); return; }
      if (event.key === 'n') { event.preventDefault(); onNewTask?.(); return; }
      if (event.key === 'j') { event.preventDefault(); onNext?.(); return; }
      if (event.key === 'k') { event.preventDefault(); onPrevious?.(); return; }
      if (event.key === 'e') { event.preventDefault(); onEdit?.(); return; }
      if (event.key === '?') { event.preventDefault(); window.dispatchEvent(new CustomEvent('telos:shortcuts')); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onNewTask, onFocusSearch, onNext, onPrevious, onEdit]);
}

function flatten(nodes) {
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
