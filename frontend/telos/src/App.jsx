import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Logo } from './brand.jsx';
import { Icon } from './icons.jsx';
import { ConfirmHost, Loading, Toaster, useAsync } from './ui.jsx';
import { api } from './api.js';
import { CommandPalette, ShortcutSheet, useShortcuts } from './Command.jsx';
import { moodFor, moodImage } from './mascot.js';
import { DEMO } from './api.js';
import Login from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Account from './pages/Account.jsx';
import Projects from './pages/Projects.jsx';
import ProjectPage from './pages/ProjectPage.jsx';
import ProjectSheetEditor from './pages/ProjectSheetEditor.jsx';
import Home from './pages/Home.jsx';
import Meetings from './pages/Meetings.jsx';
import People from './pages/People.jsx';
import PersonPage from './pages/PersonPage.jsx';
import Access from './pages/Access.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function OfflineBanner() {
  const [offline, setOffline] = useState(() => (
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  ));

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="offline-bar" role="status" aria-live="polite">
      You're offline. Changes won't save until your connection returns.
    </div>
  );
}

function Shell() {
  const { user, ready, logout } = useAuth();
  const loc = useLocation();
  const attention = useAsync(() => api('/attention'), []);
  const needs = attention.data?.attention || null;
  if (!ready) return <Loading label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  const initials = String(user.name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
  const role = user.isOwner ? 'Owner' : (user.roles || []).join(', ') || 'Member';

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="side">
        <div className="brand-wrap">
          <div className="brand-scrap paper-card">
            <Logo className="brand-logo" sizes="(max-width: 860px) 150px, 208px" sidebar />
          </div>
          <img className="mobile-mascot" src={moodImage(moodFor(needs), true)} alt="" aria-hidden="true" />
        </div>
        <nav aria-label="Primary">
          <NavLink to="/" end>
            <Icon name="home" />
            <span>Home</span>
          </NavLink>
          <NavLink to="/projects">
            <Icon name="folder" />
            <span>Projects</span>
          </NavLink>
          <NavLink to="/meetings">
            <Icon name="calendar" />
            <span>Meetings</span>
          </NavLink>
          {user.isOwner && (
            <NavLink to="/people">
              <Icon name="users" />
              <span>People</span>
            </NavLink>
          )}
          {user.isOwner && (
            <NavLink to="/access">
              <Icon name="key" />
              <span>Roles &amp; access</span>
            </NavLink>
          )}
          <NavLink to="/account">
            <Icon name="user" />
            <span>Account</span>
          </NavLink>
        </nav>
        {needs && (
          <div className="side-note">
            <img className="side-note-face" src={moodImage(moodFor(needs), true)} alt="" />
            <div className="side-note-body">
              <p className="side-note-line">{assistantLine(needs)}</p>
              {assistantLink(needs) && (
                <Link className="side-note-link" to={assistantLink(needs)}>
                  {assistantAction(needs)}
                </Link>
              )}
            </div>
          </div>
        )}
        <div className="me">
          <div className="me-row">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <div className="me-id">
              <strong>{user.name}</strong>
              <span className="role-badge">{role}</span>
            </div>
          </div>
          <button type="button" className="signout" aria-label="Sign out" onClick={logout}>
            <Icon name="logout" size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        {DEMO && <div className="demo-bar">Demo mode: sample data stored in this page only. Nothing is sent to a server.</div>}
        <Outlet />
      </main>
    </div>
  );
}

function OwnerOnly({ children }) {
  const { user } = useAuth();
  return user?.isOwner ? children : <div className="note error">Only the owner can open this page.</div>;
}

// What the studio assistant says, and where it sends you. It names the first
// thing that needs a person rather than quoting a number.
const ASSISTANT_ORDER = [
  { key: 'overdue', line: (item) => `\u201c${item.title}\u201d is late.`, action: 'See what is late' },
  { key: 'due_soon', line: (item) => `\u201c${item.title}\u201d is due ${item.due?.relative || 'soon'}.`, action: 'See what is due' },
  { key: 'unassigned', line: (item) => `\u201c${item.title}\u201d has no owner.`, action: 'See what is unowned' },
  { key: 'stale', line: (item) => `\u201c${item.title}\u201d has not moved.`, action: 'See what is stalled' }
];

function assistantPick(attention) {
  for (const entry of ASSISTANT_ORDER) {
    const items = attention[entry.key] || [];
    if (items.length) return { entry, item: items[0], count: items.length };
  }
  return null;
}

function assistantLine(attention) {
  const pick = assistantPick(attention);
  if (!pick) return 'Nothing needs you right now.';
  const rest = pick.count - 1;
  return rest ? `${pick.entry.line(pick.item)} And ${rest} more.` : pick.entry.line(pick.item);
}

function assistantLink(attention) {
  const pick = assistantPick(attention);
  if (!pick) return null;
  return `/projects/${pick.item.project_id}?tab=attention`;
}

function assistantAction(attention) {
  const pick = assistantPick(attention);
  if (!pick) return 'Open the attention view';
  return pick.entry.action;
}

export default function App() {
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const openCommand = () => setCommandOpen(true);
    const openShortcuts = () => setShortcutsOpen(true);
    window.addEventListener('telos:command', openCommand);
    window.addEventListener('telos:shortcuts', openShortcuts);
    return () => {
      window.removeEventListener('telos:command', openCommand);
      window.removeEventListener('telos:shortcuts', openShortcuts);
    };
  }, []);

  useShortcuts({
    onNewTask: () => window.dispatchEvent(new CustomEvent('telos:new-task')),
    onFocusSearch: () => window.dispatchEvent(new CustomEvent('telos:focus-search')),
    onNext: () => window.dispatchEvent(new CustomEvent('telos:next-task')),
    onPrevious: () => window.dispatchEvent(new CustomEvent('telos:previous-task')),
    onEdit: () => window.dispatchEvent(new CustomEvent('telos:edit-task'))
  });

  return (
    <>
    <ScrollToTop />
    <OfflineBanner />
    <ConfirmHost />
    <Toaster />
    <CommandPalette
      open={commandOpen}
      onClose={() => setCommandOpen(false)}
      onNewTask={() => window.dispatchEvent(new CustomEvent('telos:new-task'))}
    />
    <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* The full editor is deliberately outside the Shell so the spreadsheet
          gets the whole viewport. It guards its own session above. */}
      <Route path="/projects/:id/sheet/editor" element={<ProjectSheetEditor />} />
      <Route path="/projects/:id/contract-template/editor" element={<ProjectSheetEditor kind="contract" />} />
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="account" element={<Account />} />
        <Route path="people" element={<OwnerOnly><People /></OwnerOnly>} />
        <Route path="people/:id" element={<OwnerOnly><PersonPage /></OwnerOnly>} />
        <Route path="access" element={<OwnerOnly><Access /></OwnerOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </>
  );
}
