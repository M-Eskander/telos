// In-browser fake of the Telos API, used when VITE_DEMO is set. Nothing leaves the page.
import { ApiError } from './errors.js';

const fail = (s, m) => { throw new ApiError(s, m); };

// The derivation rules, mirroring the API. The demo is a stand-in for the
// server, so it publishes the same rules the real endpoint does.
const TASK_RULES = {
  version: '1',
  weight: { min: 0, max: 12, step: 0.5 },
  bands: [
    { priority: 'low', min: 0, max: 3 },
    { priority: 'medium', min: 3, max: 6 },
    { priority: 'high', min: 6, max: 9 },
    { priority: 'critical', min: 9, max: 12 }
  ],
  priorities: ['low', 'medium', 'high', 'critical'],
  statuses: ['todo', 'in_progress', 'done'],
  status: { todo: { max: 0 }, in_progress: { min: 1, max: 99 }, done: { min: 100 } }
};
// The access levels, mirroring the API's published list.
const ACCESS_PRESETS = {
  version: '1',
  presets: [
    { key: 'project_admin', attribute: 'project_admin', label: 'Owner-like', description: 'Manage this project, its team, and every task. Cannot delete the project.' },
    { key: 'project_manager', attribute: 'project_manager', label: 'Project manager', description: 'Manage every task and the project team. Cannot change project settings or delete the project.' },
    { key: 'project_member', attribute: 'project_member', label: 'Team member', description: 'Read everything in this project. Update progress only on tasks assigned to them.' },
    { key: 'project_limited', attribute: 'project_limited', label: 'Low-access member', description: 'See only assigned tasks. Update progress only on those tasks.' }
  ]
};
const WEIGHT_MIN = TASK_RULES.weight.min;
const WEIGHT_MAX = TASK_RULES.weight.max;
const priorityForWeight = (weight) => {
  const value = Number(weight);
  if (!Number.isFinite(value)) return 'low';
  const band = TASK_RULES.bands.find((b) => value <= b.max);
  return (band || TASK_RULES.bands[TASK_RULES.bands.length - 1]).priority;
};
const statusForProgress = (progress) => {
  const value = Number(progress);
  if (!Number.isFinite(value) || value <= TASK_RULES.status.todo.max) return 'todo';
  if (value >= TASK_RULES.status.done.min) return 'done';
  return 'in_progress';
};
const ct = (id, uid, s, e, terms) => ({ id, user_id: uid, file_url: `/api/admin/contracts/${id}/file`, terms, start_date: s, end_date: e, original_name: `contract-${uid}.pdf`, mime_type: 'application/pdf', file_size: 182400, uploaded: true });
const P = (id, name, email, loc, age, roles, active = true) => ({ id, name, email, phone_number: `555-01${String(id).padStart(2, '0')}`, location: loc, age, is_active: active, isOwner: id === 1, roles, attrs: [] });
const T = (id, project_id, parent, title, status, priority, progress, weight, start, end, a, description = null) =>
  ({ id, project_id, parent_task_id: parent, title, description, status, priority, progress, weight, start_date: start, end_date: end, assignee_ids: a, created_by: 1, created_at: '2026-10-01T09:00:00Z' });

const db = {
  session: null,
  next: { person: 7, project: 3, task: 20, dept: 20, contract: 20, role: 10, attr: 20, perm: 20 },
  people: [
    P(1, 'Maya Okafor', 'owner@telos.demo', 'Lagos', 41, []),
    P(2, 'Daniel Reyes', 'daniel@telos.demo', 'Madrid', 36, [{ name: 'project-manager', resourceType: 'project', resourceId: 1 }]),
    P(3, 'Priya Nair', 'member@telos.demo', 'Bengaluru', 29, [{ name: 'designer', resourceType: null, resourceId: null }]),
    P(4, 'Tom Becker', 'tom@telos.demo', 'Berlin', 33, [{ name: 'engineer', resourceType: null, resourceId: null }]),
    P(5, 'Lena Fischer', 'lena@telos.demo', 'Vienna', 27, [{ name: 'designer', resourceType: null, resourceId: null }]),
    P(6, 'Sam Ortiz', 'sam@telos.demo', 'Lisbon', 38, [], false),
  ],
  contracts: [ct(1, 1, '2026-01-01', '2030-12-31', 'Owner agreement'), ct(2, 2, '2026-03-01', '2027-02-28'), ct(3, 3, '2026-06-01', '2026-12-15', 'Part-time, 24h/week'),
    ct(4, 4, '2026-02-01', '2027-01-31'), ct(5, 5, '2026-09-01', '2027-08-31'), ct(6, 6, '2025-01-01', '2025-12-31', 'Expired')],
  projects: [
    { id: 1, name: 'Game Alpha', description: 'Vertical slice of our first game: art direction, core gameplay and a playtest.', created_by: 1, created_at: '2026-09-28T09:00:00Z' },
    { id: 2, name: 'Website Relaunch', description: 'New marketing site and content audit.', created_by: 1, created_at: '2026-10-05T09:00:00Z' },
  ],
  departments: [{ id: 1, projectId: 1, name: 'Management' }, { id: 2, projectId: 1, name: 'Design' }, { id: 3, projectId: 1, name: 'Engineering' }, { id: 4, projectId: 2, name: 'Content' }, { id: 5, projectId: 2, name: 'Design' }],
  members: [[1, 2, 1], [1, 3, 2], [1, 4, 3], [1, 5, 2], [2, 2, 4], [2, 5, 5]].map(([projectId, userId, departmentId]) => ({ projectId, userId, departmentId })),
  memberContracts: [
    { id: 101, projectId: 1, userId: 2, source: 'uploaded', status: 'uploaded', startDate: '2026-09-28', endDate: null, hasPdf: true, hasWord: false },
    { id: 102, projectId: 1, userId: 3, source: 'uploaded', status: 'uploaded', startDate: '2026-09-28', endDate: null, hasPdf: true, hasWord: false },
    { id: 103, projectId: 1, userId: 4, source: 'uploaded', status: 'uploaded', startDate: '2026-09-28', endDate: null, hasPdf: true, hasWord: false },
    { id: 104, projectId: 2, userId: 2, source: 'uploaded', status: 'uploaded', startDate: '2026-10-05', endDate: null, hasPdf: true, hasWord: false }
  ],
  tasks: [
    T(1, 1, null, 'Pre-production', 'in_progress', 'high', 0, 2, '2026-10-05', '2026-11-06', [2], 'Everything needed before building starts.'),
    T(2, 1, 1, 'Concept document', 'done', 'medium', 100, 1, '2026-10-05', '2026-10-12', [3]),
    T(3, 1, 1, 'Art style guide', 'in_progress', 'high', 60, 2, '2026-10-12', '2026-10-30', [3, 5]),
    T(4, 1, 1, 'Technical spike', 'in_progress', 'critical', 40, 3, '2026-10-14', '2026-11-06', [4]),
    T(5, 1, null, 'Core gameplay', 'in_progress', 'high', 0, 3, '2026-10-26', '2026-12-04', [4]),
    T(6, 1, 5, 'Player controller', 'in_progress', 'high', 25, 2, '2026-10-26', '2026-11-13', [4]),
    T(7, 1, 5, 'Level blockout', 'todo', 'medium', 0, 1, '2026-11-09', '2026-11-27', [5]),
    T(8, 1, 5, 'Combat prototype', 'todo', 'medium', 0, 2, '2026-11-16', '2026-12-04', [2, 4]),
    T(9, 1, null, 'Playtest round 1', 'todo', 'high', 0, 1, '2026-12-07', '2026-12-11', [2]),
    T(10, 1, null, 'Release planning', 'todo', 'low', 0, 1, null, null, [2]),
    T(11, 2, null, 'Content audit', 'in_progress', 'medium', 50, 1, '2026-10-12', '2026-10-30', [2]),
    T(12, 2, null, 'New homepage', 'todo', 'high', 0, 2, '2026-11-02', '2026-11-27', [5]),
  ],
  attributes: [[1, 'read-project', 'project'], [2, 'edit-project', 'project'], [3, 'read-task', 'task'], [4, 'write-task', 'task'], [5, 'manage-team', 'project'], [6, 'is_active', 'global']]
    .map(([id, name, resource]) => ({ id, name, resource, description: `Allows ${name.replace('-', ' ')}` })),
  roles: [{ id: 1, name: 'owner', attrs: [] }, { id: 2, name: 'project-manager', attrs: [1, 2, 3, 4, 5] }, { id: 3, name: 'designer', attrs: [1, 3, 4] }, { id: 4, name: 'engineer', attrs: [1, 3, 4] }],
  permissions: [[1, 'read', 'project', [[1, 6], [2]]], [2, 'update', 'project', [[2]]], [3, 'read', 'task', [[3]]], [4, 'create', 'task', [[4]]], [5, 'update', 'task', [[4]]], [6, 'delete', 'task', [[2, 4]]], [7, 'create', 'project', []], [8, 'read', 'public', [[]]]]
    .map(([id, action, resource, alternatives]) => ({ id, action, resource, alternatives, description: '' })),
};

const person = (id) => db.people.find((p) => p.id === id);
const me = () => person(db.session);
const isActiveMember = (pid, uid) => person(uid)?.is_active && db.members.some((m) => m.projectId === pid && m.userId === uid);
const brief = (u) => ({ id: u.id, name: u.name, email: u.email });
const userOut = (u) => ({ id: u.id, name: u.name, email: u.email, phone_number: u.phone_number, roles: u.isOwner ? ['owner'] : u.roles.map((r) => r.name), roleAssignments: u.roles, isOwner: !!u.isOwner });
const attrOut = (a) => { const d = db.attributes.find((x) => x.id === a.attributeId); return { attributeId: a.attributeId, name: d?.name, resource: d?.resource, resourceId: a.resourceId ?? null, ...(a.mode ? { mode: a.mode } : {}) }; };

// Guards
const auth = () => { if (!me()) fail(401, 'Please sign in.'); return me(); };
const owner = () => { if (!auth().isOwner) fail(403, 'Owner access required.'); };
const proj = (id) => {
  const u = auth(); const p = db.projects.find((x) => x.id === id);
  if (!p) fail(404, 'Project not found.');
  if (!u.isOwner && id !== 1) fail(403, 'You do not have access to this project.');
  return p;
};
const ownerOnlyProject = (id) => { proj(id); if (!me().isOwner) fail(403, 'You do not have permission to change this project.'); };

// Task derivation, mirrored from the API: a task with subtasks takes its
// weight, progress, priority and status from them. Weight drives priority and
// progress drives status.
const taskTree = (pid) => {
  const all = db.tasks.filter((t) => t.project_id === pid);
  const nodes = new Map(all.map((t) => [t.id, { ...t, subtasks: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parent_task_id ? nodes.get(node.parent_task_id) : null;
    if (parent) parent.subtasks.push(node);
    else roots.push(node);
  }
  return roots;
};
const deriveNode = (node) => {
  const children = node.subtasks.map(deriveNode);
  let weight;
  let progress;
  if (children.length) {
    const average = children.reduce((sum, child) => sum + child.weight, 0) / children.length;
    weight = Math.round(average * 100) / 100;
    const counted = children.filter((child) => child.weight > 0);
    const total = counted.reduce((sum, child) => sum + child.weight, 0);
    progress = total > 0
      ? Math.round(counted.reduce((sum, child) => sum + child.progress * child.weight, 0) / total)
      : 0;
  } else {
    weight = node.weight === null || node.weight === undefined ? 1 : Number(node.weight);
    progress = Number(node.progress) || 0;
  }
  return {
    ...node,
    children,
    weight,
    progress,
    priority: priorityForWeight(weight),
    status: statusForProgress(progress)
  };
};
const recalc = (pid = null) => {
  const ids = pid ? [pid] : [...new Set(db.tasks.map((t) => t.project_id))];
  for (const id of ids) {
    const derived = taskTree(id).map(deriveNode);
    const flat = [];
    const walk = (node) => { flat.push(node); node.children.forEach(walk); };
    derived.forEach(walk);
    for (const node of flat) {
      const stored = db.tasks.find((t) => t.id === node.id);
      if (!stored) continue;
      stored.weight = node.weight;
      stored.progress = node.progress;
      stored.priority = node.priority;
      stored.status = node.status;
    }
    const project = db.projects.find((x) => x.id === id);
    if (project) {
      const counted = derived.filter((root) => root.weight > 0);
      const total = counted.reduce((sum, root) => sum + root.weight, 0);
      project.progress = total > 0
        ? Math.round(counted.reduce((sum, root) => sum + root.progress * root.weight, 0) / total)
        : 0;
    }
  }
};
const projectOut = (p) => ({ ...p });
const projectPermissions = (u, p) => {
  if (u.isOwner) return ['*'];
  if (p.id !== 1) return [];
  const manager = u.roles.some((r) => r.name === 'project-manager' && (!r.resourceId || r.resourceId === p.id));
  return manager
    ? ['read:project', 'read:task', 'create:task', 'update:task', 'delete:task', 'update:project']
    : ['read:project', 'read:task'];
};
const projectFor = (u, p) => ({ ...projectOut(p), permissions: projectPermissions(u, p) });
const authUser = (u) => ({ ...userOut(u), permissions: u.isOwner ? ['*'] : [] });
const taskOut = (t) => ({ ...t, assignees: t.assignee_ids.map(person).filter((u) => u?.is_active).map(brief) });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function checkTask(b, pid, current) {
  const bad = (m) => fail(400, m);
  if ('title' in b && !String(b.title || '').trim()) bad('Title is required.');
  if ('progress' in b && !(Number.isInteger(b.progress) && b.progress >= 0 && b.progress <= 100)) bad('Progress must be a whole number from 0 to 100.');
  if ('weight' in b && !(Number.isFinite(Number(b.weight)) && Number(b.weight) >= WEIGHT_MIN && Number(b.weight) <= WEIGHT_MAX)) {
    bad(`Weight must be a number from ${WEIGHT_MIN} to ${WEIGHT_MAX}.`);
  }
  ['start_date', 'end_date'].forEach((k) => { if (b[k] && !DATE.test(b[k])) bad('Dates must use YYYY-MM-DD.'); });
  const s = 'start_date' in b ? b.start_date : current?.start_date;
  const e = 'end_date' in b ? b.end_date : current?.end_date;
  if (s && e && e < s) bad('End date cannot be before the start date.');
  (b.assignee_ids || []).forEach((id) => { if (!isActiveMember(pid, id)) bad('Assignees must be active project members.'); });
  if (b.parent_task_id && !db.tasks.some((t) => t.id === b.parent_task_id && t.project_id === pid)) bad('Parent task not found in this project.');
}
// Status and priority are derived, so they are never taken from the request.
const pickTask = (b) => Object.fromEntries(['title', 'description', 'progress', 'weight', 'start_date', 'end_date', 'assignee_ids'].filter((k) => k in b).map((k) => [k, b[k]]));

const personDetail = (u) => ({
  ...u, roles: u.isOwner ? [{ id: 1, name: 'owner', resourceType: null, resourceId: null }] : u.roles.map((r) => ({ id: db.roles.find((x) => x.name === r.name)?.id, ...r })),
  attributes: u.attrs.map(attrOut), contracts: db.contracts.filter((c) => c.user_id === u.id), hasContract: db.contracts.some((c) => c.user_id === u.id),
  projectMemberships: db.members
    .filter((m) => m.userId === u.id)
    .map((m) => {
      const project = db.projects.find((p) => p.id === m.projectId);
      return {
        projectId: m.projectId,
        projectName: project?.name || `Project ${m.projectId}`,
        departmentId: m.departmentId,
        departmentName: db.departments.find((d) => d.id === m.departmentId)?.name || null
      };
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName)),
  projectContracts: db.memberContracts
    .filter((c) => c.userId === u.id)
    .map((c) => ({
      ...c,
      projectName: db.projects.find((p) => p.id === c.projectId)?.name || `Project ${c.projectId}`
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName)),
});
const noAttrs = ({ attributes, ...rest }) => rest;
const listPerson = (u) => ({ ...noAttrs(personDetail(u)), roles: userOut(u).roles, roleAssignments: u.roles, is_active: u.is_active ? 1 : 0 });
const links = (xs = []) => xs.map((a) => ({ attributeId: n(a.attributeId), resourceId: a.resourceId ?? null, ...(a.mode ? { mode: a.mode } : {}) }));
const permOut = (p) => ({ ...p, alternatives: p.alternatives.map((alt) => alt.map((id) => { const a = db.attributes.find((x) => x.id === id); return { name: a.name, resource: a.resource }; })) });

const routes = [];
const on = (method, pattern, fn) => routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), fn]);
const n = (x) => Number(x);

on('POST', '/auth/login', (_, b) => {
  const u = db.people.find((p) => p.email === String(b.email).trim().toLowerCase());
  if (!u || !u.is_active || !b.password) fail(401, 'Invalid email or password.');
  db.session = u.id; return { ok: true, user: authUser(u) };
});
on('GET', '/auth/me', () => ({ ok: true, user: authUser(auth()) }));
on('POST', '/auth/logout', () => { db.session = null; return { ok: true }; });
on('POST', '/auth/bootstrap-owner', () => fail(409, 'An owner already exists (demo).'));

on('GET', '/projects', () => { const u = auth(); return { ok: true, projects: db.projects.filter((p) => u.isOwner || p.id === 1).map((p) => projectFor(u, p)) }; });
on('POST', '/projects', (_, b) => {
  owner(); if (!String(b.name || '').trim()) fail(400, 'Name is required.');
  const p = { id: db.next.project++, name: b.name.trim(), description: b.description || null, created_by: me().id, created_at: new Date().toISOString() };
  db.projects.push(p); return { ok: true, project: projectFor(me(), p) };
});
on('GET', '/projects/:id', ([id]) => { const u = auth(); return { ok: true, project: projectFor(u, proj(n(id))) }; });
on('PATCH', '/projects/:id', ([id], b) => {
  ownerOnlyProject(n(id)); const p = proj(n(id));
  if ('name' in b) { if (!String(b.name).trim()) fail(400, 'Name is required.'); p.name = b.name.trim(); }
  if ('description' in b) p.description = b.description;
  return { ok: true, project: projectFor(me(), p) };
});
on('DELETE', '/projects/:id', ([id]) => {
  ownerOnlyProject(n(id)); const pid = n(id);
  db.projects = db.projects.filter((p) => p.id !== pid); db.tasks = db.tasks.filter((t) => t.project_id !== pid);
  db.departments = db.departments.filter((d) => d.projectId !== pid); db.members = db.members.filter((m) => m.projectId !== pid);
  return { ok: true, message: 'Project deleted.' };
});

on('GET', '/projects/:id/departments', ([id]) => { proj(n(id)); return { ok: true, departments: db.departments.filter((d) => d.projectId === n(id)) }; });
on('POST', '/projects/:id/departments', ([id], b) => {
  ownerOnlyProject(n(id)); const name = String(b.name || '').trim();
  if (!name) fail(400, 'Name is required.');
  if (db.departments.some((d) => d.projectId === n(id) && d.name.toLowerCase() === name.toLowerCase())) fail(409, 'That department already exists.');
  const d = { id: db.next.dept++, projectId: n(id), name }; db.departments.push(d); return { ok: true, department: d };
});
on('DELETE', '/projects/:id/departments/:did', ([id, did]) => {
  ownerOnlyProject(n(id));
  db.departments = db.departments.filter((d) => d.id !== n(did));
  db.members.forEach((m) => { if (m.departmentId === n(did)) m.departmentId = null; });
  return { ok: true };
});
on('GET', '/projects/:id/members', ([id]) => {
  proj(n(id));
  return { ok: true, members: db.members.filter((m) => m.projectId === n(id) && person(m.userId).is_active).map((m) => {
    const u = person(m.userId);
    const contract = db.memberContracts.find((c) => c.projectId === n(id) && c.userId === u.id);
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      phoneNumber: u.phone_number,
      projectId: m.projectId,
      departmentId: m.departmentId,
      departmentName: db.departments.find((d) => d.id === m.departmentId)?.name ?? null,
      contractId: contract?.id ?? null,
      hasProjectContract: Boolean(contract)
    };
  }) };
});
on('POST', '/projects/:id/members', ([id], f) => {
  ownerOnlyProject(n(id));
  const uid = n(f.get ? f.get('userId') : f.userId);
  const u = person(uid);
  if (!u?.is_active) fail(400, 'Only active people can be members.');
  if (db.members.some((m) => m.projectId === n(id) && m.userId === uid)) {
    fail(400, 'This person is already a member of the project');
  }
  const contract = f.get ? f.get('contract') : null;
  if (!contract) fail(400, 'A project contract PDF is required to add someone to a project');
  const rawDep = f.get ? f.get('departmentId') : null;
  const dep = rawDep ? n(rawDep) : null;
  if (dep && !db.departments.some((d) => d.id === dep && d.projectId === n(id))) {
    fail(400, 'Department does not belong to this project.');
  }
  db.members.push({ projectId: n(id), userId: uid, departmentId: dep });
  const memberContract = {
    id: db.next.contract++,
    projectId: n(id),
    userId: uid,
    source: 'uploaded',
    status: 'uploaded',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: null,
    hasPdf: true,
    hasWord: false
  };
  db.memberContracts.push(memberContract);
  return {
    ok: true,
    member: {
      userId: u.id,
      name: u.name,
      email: u.email,
      projectId: n(id),
      departmentId: dep,
      departmentName: db.departments.find((d) => d.id === dep)?.name ?? null,
      contractId: memberContract.id,
      hasProjectContract: true
    }
  };
});
on('POST', '/projects/:id/members/:uid/contract', ([id, uid], f) => {
  ownerOnlyProject(n(id));
  const userId = n(uid);
  if (!db.members.some((m) => m.projectId === n(id) && m.userId === userId)) {
    fail(400, 'This person is not a member of the project');
  }
  const contract = f.get ? f.get('contract') : null;
  if (!contract) fail(400, 'A project contract PDF is required');
  let existing = db.memberContracts.find((c) => c.projectId === n(id) && c.userId === userId);
  if (!existing) {
    existing = {
      id: db.next.contract++,
      projectId: n(id),
      userId,
      source: 'uploaded',
      status: 'uploaded',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: null,
      hasPdf: true,
      hasWord: false
    };
    db.memberContracts.push(existing);
  }
  return { ok: true, contract: { id: existing.id } };
});
on('PUT', '/projects/:id/members/:uid', ([id, uid], b) => {
  ownerOnlyProject(n(id));
  if (!person(n(uid))?.is_active) fail(400, 'Only active people can be members.');
  const dep = b?.departmentId ?? null;
  if (dep && !db.departments.some((d) => d.id === dep && d.projectId === n(id))) fail(400, 'Department does not belong to this project.');
  const m = db.members.find((x) => x.projectId === n(id) && x.userId === n(uid));
  if (m) m.departmentId = dep; else db.members.push({ projectId: n(id), userId: n(uid), departmentId: dep });
  return { ok: true, member: { userId: n(uid), projectId: n(id), departmentId: dep } };
});
on('DELETE', '/projects/:id/members/:uid', ([id, uid]) => {
  ownerOnlyProject(n(id));
  db.members = db.members.filter((m) => !(m.projectId === n(id) && m.userId === n(uid)));
  db.memberContracts = db.memberContracts.filter((c) => !(c.projectId === n(id) && c.userId === n(uid)));
  db.tasks.filter((t) => t.project_id === n(id)).forEach((t) => { t.assignee_ids = t.assignee_ids.filter((a) => a !== n(uid)); });
  return { ok: true };
});

on('GET', '/meta/task-rules', () => ({ ok: true, rules: TASK_RULES }));

on('GET', '/attention', () => {
  const tasks = db.tasks.filter((t) => t.project_id === 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const late = tasks.filter((t) => t.progress < 100 && t.end_date && new Date(t.end_date) < today);
  const soon = tasks.filter((t) => t.progress < 100 && t.end_date && new Date(t.end_date) >= today
    && (new Date(t.end_date) - today) / 86400000 <= 7);
  const unowned = tasks.filter((t) => t.progress < 100 && !t.assignee_ids.length);
  const shape = (list) => list.map((t) => ({
    id: t.id,
    title: t.title,
    progress: t.progress,
    end_date: t.end_date,
    project_id: t.project_id,
    project_name: 'Game Alpha',
    due: { date: t.end_date, relative: 'in 3 days' },
    schedule: { state: 'overdue' },
    assignees: []
  }));
  return {
    ok: true,
    attention: {
      overdue: shape(late),
      due_soon: shape(soon),
      unassigned: shape(unowned),
      stale: [],
      blocked: [],
      projects: 1
    }
  };
});
on('GET', '/meta/access-presets', () => ({ ok: true, ...ACCESS_PRESETS }));

on('GET', '/projects/:id/tasks', ([id]) => {
  proj(n(id)); recalc(n(id));
  const out = (node) => ({ ...taskOut(node), subtasks: node.subtasks.map(out) });
  return { success: true, data: taskTree(n(id)).map(out) };
});
on('POST', '/projects/:id/tasks', ([id], b) => {
  proj(n(id)); checkTask({ ...b, title: b.title ?? '' }, n(id));
  const t = { id: db.next.task++, project_id: n(id), parent_task_id: b.parent_task_id ?? null, title: b.title.trim(), description: null, status: 'todo', priority: 'low', progress: 0, weight: 1, start_date: null, end_date: null, assignee_ids: [], created_by: me().id, created_at: new Date().toISOString(), ...pickTask(b) };
  db.tasks.push(t); recalc(n(id)); return { success: true, data: taskOut(t) };
});
on('PATCH', '/projects/:id/tasks/bulk', ([id], b) => {
  proj(n(id));
  const ids = (b.ids || []).map(n);
  const tasks = db.tasks.filter((t) => t.project_id === n(id) && ids.includes(t.id));
  for (const t of tasks) {
    for (const key of ['title', 'description', 'progress', 'weight', 'start_date', 'end_date']) {
      if (b[key] !== undefined) t[key] = b[key];
    }
    if (Array.isArray(b.assignee_ids)) t.assignee_ids = b.assignee_ids;
  }
  recalc(n(id));
  return { success: true, data: tasks.map(taskOut) };
});
on('PATCH', '/projects/:id/tasks/:tid', ([id, tid], b) => {
  proj(n(id)); const t = db.tasks.find((x) => x.id === n(tid) && x.project_id === n(id));
  if (!t) fail(404, 'Task not found.');
  const hasChildren = db.tasks.some((x) => x.parent_task_id === t.id);
  if (hasChildren && ('progress' in b || 'weight' in b)) {
    fail(400, 'Progress and weight for this task are calculated from its subtasks.');
  }
  checkTask(b, n(id), t); Object.assign(t, pickTask(b)); recalc(n(id)); return { success: true, data: taskOut(t) };
});
on('PATCH', '/projects/:id/tasks/:tid/move', ([id, tid], b) => {
  proj(n(id));
  const t = db.tasks.find((x) => x.id === n(tid) && x.project_id === n(id));
  if (!t) fail(404, 'Task not found.');
  t.parent_task_id = b.parent_task_id ?? t.parent_task_id;
  recalc(n(id));
  return { success: true, data: taskOut(t) };
});
on('DELETE', '/projects/:id/tasks/:tid', ([id, tid]) => {
  proj(n(id)); if (!me().isOwner) fail(403, 'You do not have permission to delete tasks.');
  const t = db.tasks.find((x) => x.id === n(tid) && x.project_id === n(id)); if (!t) fail(404, 'Task not found.');
  db.tasks = db.tasks.filter((x) => x.id !== t.id && x.parent_task_id !== t.id); recalc(n(id)); return { success: true, message: 'Task deleted.' };
});
on('GET', '/projects/:id/attention', ([id]) => {
  proj(n(id)); recalc(n(id));
  const tasks = db.tasks.filter((t) => t.project_id === n(id));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = tasks.filter((t) => t.progress < 100 && t.end_date && new Date(t.end_date) < today);
  const dueSoon = tasks.filter((t) => t.progress < 100 && t.end_date && new Date(t.end_date) >= today
    && (new Date(t.end_date) - today) / 86400000 <= 7);
  const unassigned = tasks.filter((t) => t.progress < 100 && !t.assignee_ids.length);
  return {
    ok: true,
    attention: {
      overdue: overdue.map(taskOut),
      due_soon: dueSoon.map(taskOut),
      unassigned: unassigned.map(taskOut),
      stale: [],
      blocked: [],
      total: tasks.length
    }
  };
});
on('GET', '/projects/:id/timeline', ([id]) => {
  proj(n(id)); recalc(n(id));
  const key = (t) => t.start_date || t.end_date;
  return { ok: true, tasks: db.tasks.filter((t) => t.project_id === n(id) && key(t)).sort((a, b) => key(a).localeCompare(key(b)) || a.id - b.id).map(taskOut) };
});

// Owner-only admin
on('GET', '/admin/people', () => { owner(); return { ok: true, people: db.people.map(listPerson) }; });
on('POST', '/admin/people', (_, f) => {
  owner(); const g = (k) => f.get(k) || '';
  ['name', 'email', 'phone_number', 'password', 'contract_start_date', 'contract_end_date'].forEach((k) => { if (!g(k)) fail(400, `${k.replace(/_/g, ' ')} is required.`); });
  if (!f.get('contract')) fail(400, 'A contract PDF is required.');
  if (g('contract_end_date') < g('contract_start_date')) fail(400, 'Contract end date cannot be before the start date.');
  if (db.people.some((p) => p.email === g('email').toLowerCase())) fail(409, 'That email is already in use.');
  const u = { ...P(db.next.person++, g('name'), g('email').toLowerCase(), g('location') || null, g('age') ? n(g('age')) : null, []) , phone_number: g('phone_number') };
  db.people.push(u);
  db.contracts.push({ ...ct(db.next.contract++, u.id, g('contract_start_date'), g('contract_end_date'), g('contract_terms') || null), original_name: f.get('contract').name, file_size: f.get('contract').size });
  return { ok: true, person: noAttrs(personDetail(u)) };
});
on('GET', '/admin/people/:uid', ([uid]) => { owner(); const u = person(n(uid)); if (!u) fail(404, 'Person not found.'); return { ok: true, person: personDetail(u) }; });
on('PATCH', '/admin/people/:uid', ([uid], b) => {
  owner(); const u = person(n(uid)); if (!u) fail(404, 'Person not found.');
  if (b.is_active === false && u.isOwner) fail(400, 'The owner cannot be archived.');
  if (b.is_active === true && !db.contracts.some((c) => c.user_id === u.id && c.start_date && c.end_date)) fail(400, 'Reactivation needs a contract with start and end dates.');
  if (b.email && db.people.some((p) => p.id !== u.id && p.email === b.email.toLowerCase())) fail(409, 'That email is already in use.');
  ['name', 'email', 'phone_number', 'location', 'age', 'is_active'].forEach((k) => { if (k in b) u[k] = k === 'email' ? b[k].toLowerCase() : b[k]; });
  return { ok: true, person: personDetail(u) };
});
on('POST', '/admin/people/:uid/contracts', ([uid], f) => {
  owner(); if (!f.get('contract')) fail(400, 'A contract PDF is required.');
  const c = { ...ct(db.next.contract++, n(uid), f.get('contract_start_date'), f.get('contract_end_date'), f.get('contract_terms') || null), original_name: f.get('contract').name, file_size: f.get('contract').size };
  db.contracts.push(c); return { ok: true, contract: c };
});
on('PUT', '/admin/people/:uid/roles', ([uid], b) => {
  owner(); const u = person(n(uid));
  u.roles = (b.roles || []).map((r) => (typeof r === 'string' ? { name: r, resourceType: null, resourceId: null } : r));
  u.roles.forEach((r) => { if (!db.roles.some((x) => x.name === r.name) || r.name === 'owner') fail(400, `Unknown or reserved role: ${r.name}`); });
  return { ok: true };
});
on('PUT', '/admin/people/:uid/attributes', ([uid], b) => { owner(); const l = links(b.attributes); person(n(uid)).attrs = l; return { ok: true, attributes: l }; });

on('GET', '/admin/roles', () => { owner(); return { ok: true, roles: db.roles.map(({ id, name }) => ({ id, name })) }; });
on('POST', '/admin/roles', (_, b) => {
  owner(); const name = String(b.name || '').trim(); if (!name) fail(400, 'Name is required.');
  if (db.roles.some((r) => r.name === name)) fail(409, 'That role already exists.');
  const r = { id: db.next.role++, name, attrs: [] }; db.roles.push(r); return { ok: true, role: { id: r.id, name } };
});
on('GET', '/admin/roles/:rid', ([rid]) => { owner(); const r = db.roles.find((x) => x.id === n(rid)); if (!r) fail(404, 'Role not found.'); return { ok: true, role: { id: r.id, name: r.name, attributes: r.attrs.map((a) => attrOut(typeof a === 'object' ? a : { attributeId: a })) } }; });
on('PUT', '/admin/roles/:rid/attributes', ([rid], b) => { owner(); const l = links(b.attributes); db.roles.find((x) => x.id === n(rid)).attrs = l; return { ok: true, attributes: l }; });
on('GET', '/admin/attributes', () => { owner(); return { ok: true, attributes: db.attributes }; });
on('POST', '/admin/attributes', (_, b) => {
  owner(); if (!b.name || !b.resource) fail(400, 'Name and resource are required.');
  if (db.attributes.some((a) => a.name === b.name)) fail(409, 'That attribute already exists.');
  const a = { id: db.next.attr++, name: b.name, resource: b.resource, description: b.description || '' }; db.attributes.push(a); return { ok: true, attribute: a };
});
on('GET', '/admin/permissions', () => { owner(); return { ok: true, permissions: db.permissions.map(permOut) }; });
on('POST', '/admin/permissions', (_, b) => {
  owner(); if (!b.action || !b.resource) fail(400, 'Action and resource are required.');
  if (db.permissions.some((p) => p.action === b.action && p.resource === b.resource)) fail(409, 'That permission already exists.');
  const p = { id: db.next.perm++, action: b.action, resource: b.resource, description: b.description || '', alternatives: [] }; db.permissions.push(p); return { ok: true, permission: permOut(p) };
});
on('PUT', '/admin/permissions/:pid/grants', ([pid], b) => {
  owner(); const p = db.permissions.find((x) => x.id === n(pid));
  if ((b.alternatives || []).some((a) => a.length === 0) && p.resource !== 'public') fail(400, 'Each option needs at least one attribute.');
  p.alternatives = b.alternatives || []; return { ok: true, id: p.id, grants: p.alternatives };
});

export async function demoApi(path, { method = 'GET', body, form } = {}) {
  await new Promise((r) => setTimeout(r, 120));
  const pathname = path.split('?')[0];
  for (const [m, re, fn] of routes) {
    const x = m === method && re.exec(pathname);
    if (x) return structuredClone(await fn(x.slice(1), form ?? body ?? {}));
  }
  return fail(404, 'Not found (demo).');
}

export function demoDownload(c) {
  const txt = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 60 Td (Demo contract ${c.id}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  return new Blob([txt], { type: 'application/pdf' });
}
