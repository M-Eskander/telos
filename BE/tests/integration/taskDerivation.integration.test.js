const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const accessPresetsSeed = require('../../src/db/seeds/access_presets_seed');
const pdpService = require('../../src/services/pdp.service');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;

async function createPerson(overrides = {}) {
  const fields = {
    name: 'Project Person',
    email: 'project-person@example.com',
    phone_number: '5550100',
    password: 'password',
    contract_start_date: '2026-01-01',
    contract_end_date: '2027-01-01',
    ...overrides
  };
  let builder = ownerAgent.post('/api/admin/people');
  for (const [field, value] of Object.entries(fields)) {
    builder = builder.field(
      field,
      value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    );
  }
  const response = await builder.attach(
    'contract',
    Buffer.from('%PDF-1.7\nTest contract\n%%EOF'),
    { filename: 'contract.pdf', contentType: 'application/pdf' }
  );
  if (response.status === 201 && response.body && response.body.person) {
    await testDb('users')
      .where({ id: response.body.person.id })
      .update({ email_verified_at: new Date() });
  }
  return response;
}

async function login(email) {
  const agent = request.agent(app);
  return agent.post('/api/auth/login').send({ email, password: 'password' }).then(response => {
    expect(response.status).toBe(200);
    return agent;
  });
}

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await testDb('owner_account').del();
  await testDb('contracts').del();
  await testDb('permission_attributes').del();
  await testDb('permission_grant_groups').del();
  await testDb('user_attributes').del();
  await testDb('role_attributes').del();
  await testDb('user_roles').del();
  await testDb('task_assignment').del();
  await testDb('tasks').del();
  await testDb('project_memberships').del();
  await testDb('project_departments').del();
  await testDb('projects').del();
  await testDb('users').del();
  await accessPresetsSeed.seed(testDb);
  pdpService._clearCache();

  const bootstrap = await request(app).post('/api/auth/bootstrap-owner').send({
    name: 'Studio Owner',
    email: 'owner@example.com',
    phone_number: '5550199',
    password: 'password',
    setup_secret: setupSecret
  });
  expect(bootstrap.status).toBe(201);
  await testDb('users').where({ id: bootstrap.body.user.id }).update({
    email_verified_at: Date.now()
  });
  ownerAgent = await login('owner@example.com');
});

afterAll(async () => {
  delete process.env.OWNER_SETUP_SECRET;
  await knex.destroy();
});

async function createProject(name = 'Derivation Project') {
  const response = await ownerAgent.post('/api/projects').send({ name });
  expect(response.status).toBe(201);
  return response.body.project;
}

async function createTask(projectId, body) {
  const response = await ownerAgent.post(`/api/projects/${projectId}/tasks`).send(body);
  expect(response.status).toBe(201);
  return response.body.data;
}

async function getTasks(projectId) {
  const response = await ownerAgent.get(`/api/projects/${projectId}/tasks`);
  expect(response.status).toBe(200);
  return response.body.data;
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (Number(node.id) === Number(id)) return node;
    const found = findNode(node.subtasks || [], id);
    if (found) return found;
  }
  return null;
}

describe('Task derivation: weight, priority, progress and status', () => {
  test('weight drives priority through the three step bands', async () => {
    const project = await createProject();
    const cases = [
      { weight: 0, priority: 'low' },
      { weight: 3, priority: 'low' },
      { weight: 3.5, priority: 'medium' },
      { weight: 6, priority: 'medium' },
      { weight: 6.5, priority: 'high' },
      { weight: 9, priority: 'high' },
      { weight: 9.5, priority: 'critical' },
      { weight: 12, priority: 'critical' }
    ];

    for (const [index, testCase] of cases.entries()) {
      const task = await createTask(project.id, {
        title: `Band ${index}`,
        weight: testCase.weight
      });
      expect(task.priority).toBe(testCase.priority);
    }

    const invalid = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Too heavy', weight: 13 });
    expect(invalid.status).toBe(400);
  });

  test('progress drives status', async () => {
    const project = await createProject();
    const todo = await createTask(project.id, { title: 'Todo', progress: 0 });
    const running = await createTask(project.id, { title: 'Running', progress: 50 });
    const done = await createTask(project.id, { title: 'Done', progress: 100 });
    expect(todo.status).toBe('todo');
    expect(running.status).toBe('in_progress');
    expect(done.status).toBe('done');
  });

  test('client supplied priority and status are ignored', async () => {
    const project = await createProject();
    const task = await createTask(project.id, {
      title: 'Derived only',
      weight: 7,
      progress: 20,
      priority: 'low',
      status: 'done'
    });
    expect(task.priority).toBe('high');
    expect(task.status).toBe('in_progress');
  });

  test('a parent derives weight, priority, progress and status from its children', async () => {
    const project = await createProject();
    const root = await createTask(project.id, { title: 'Big task', weight: 1 });
    const child = await createTask(project.id, {
      title: 'Middle task',
      parent_task_id: root.id,
      weight: 6
    });
    const grandchild = await createTask(project.id, {
      title: 'Small task',
      parent_task_id: child.id,
      weight: 9,
      progress: 50
    });

    const tasks = await getTasks(project.id);
    const rootNode = findNode(tasks, root.id);
    const childNode = findNode(tasks, child.id);
    const grandchildNode = findNode(tasks, grandchild.id);

    // The leaf keeps its own weight and progress.
    expect(grandchildNode.weight).toBe(9);
    expect(grandchildNode.progress).toBe(50);
    expect(grandchildNode.priority).toBe('high');
    expect(grandchildNode.status).toBe('in_progress');

    // The parent averages its children.
    expect(childNode.weight).toBe(9);
    expect(childNode.progress).toBe(50);
    expect(childNode.priority).toBe('high');
    expect(childNode.status).toBe('in_progress');

    // And the root averages its own child.
    expect(rootNode.weight).toBe(9);
    expect(rootNode.progress).toBe(50);
    expect(rootNode.priority).toBe('high');
    expect(rootNode.status).toBe('in_progress');

    // The tree is returned at full depth.
    expect(rootNode.subtasks[0].id).toBe(child.id);
    expect(rootNode.subtasks[0].subtasks[0].id).toBe(grandchild.id);
  });

  test('a parent weight is the average of its children', async () => {
    const project = await createProject();
    const root = await createTask(project.id, { title: 'Average parent' });
    await createTask(project.id, { title: 'Light', parent_task_id: root.id, weight: 2 });
    await createTask(project.id, { title: 'Heavy', parent_task_id: root.id, weight: 10 });

    const tasks = await getTasks(project.id);
    const rootNode = findNode(tasks, root.id);
    expect(rootNode.weight).toBe(6);
    expect(rootNode.priority).toBe('medium');
  });

  test('a task with subtasks cannot have its weight or progress edited', async () => {
    const project = await createProject();
    const root = await createTask(project.id, { title: 'Parent' });
    await createTask(project.id, { title: 'Child', parent_task_id: root.id, weight: 4, progress: 20 });

    const progress = await ownerAgent.patch(`/api/projects/${project.id}/tasks/${root.id}`)
      .send({ progress: 90 });
    expect(progress.status).toBe(400);
    expect(progress.body.message).toMatch(/calculated from its subtasks/i);

    const weight = await ownerAgent.patch(`/api/projects/${project.id}/tasks/${root.id}`)
      .send({ weight: 8 });
    expect(weight.status).toBe(400);
    expect(weight.body.message).toMatch(/calculated from its subtasks/i);

    // Editing the details that are not derived still works.
    const title = await ownerAgent.patch(`/api/projects/${project.id}/tasks/${root.id}`)
      .send({ title: 'Renamed parent' });
    expect(title.status).toBe(200);
    expect(title.body.data.title).toBe('Renamed parent');
  });

  test('progress edits roll up through the tree and into the project', async () => {
    const project = await createProject();
    const root = await createTask(project.id, { title: 'Rollup root' });
    const child = await createTask(project.id, { title: 'Rollup child', parent_task_id: root.id, weight: 1 });
    const sibling = await createTask(project.id, { title: 'Rollup sibling', parent_task_id: root.id, weight: 1 });

    await ownerAgent.patch(`/api/projects/${project.id}/tasks/${child.id}`).send({ progress: 100 });
    let tasks = await getTasks(project.id);
    expect(findNode(tasks, root.id).progress).toBe(50);
    expect(findNode(tasks, root.id).status).toBe('in_progress');

    await ownerAgent.patch(`/api/projects/${project.id}/tasks/${sibling.id}`).send({ progress: 100 });
    tasks = await getTasks(project.id);
    expect(findNode(tasks, root.id).progress).toBe(100);
    expect(findNode(tasks, root.id).status).toBe('done');

    const projects = await ownerAgent.get('/api/projects');
    const updated = projects.body.projects.find(item => item.id === project.id);
    expect(Number(updated.progress)).toBe(100);
  });

  test('low-access members see an assigned grandchild without its parents', async () => {
    const project = await createProject();
    const role = await ownerAgent.post('/api/admin/roles').send({
      name: 'Limited Derivation',
      preset: 'project_limited'
    });
    expect(role.status).toBe(201);
    const person = await createPerson({ email: 'limited-derivation@example.com' });
    await ownerAgent.put(`/api/projects/${project.id}/members/${person.body.person.id}`)
      .send({ departmentId: null });
    await ownerAgent.put(`/api/admin/people/${person.body.person.id}/roles`)
      .send({ roles: [{ name: 'Limited Derivation', resourceType: 'project', resourceId: project.id }] });

    const root = await createTask(project.id, { title: 'Hidden root' });
    const child = await createTask(project.id, { title: 'Hidden child', parent_task_id: root.id });
    const grandchild = await createTask(project.id, {
      title: 'Assigned grandchild',
      parent_task_id: child.id,
      assignee_ids: [person.body.person.id]
    });

    const memberAgent = await login('limited-derivation@example.com');
    const tasks = await memberAgent.get(`/api/projects/${project.id}/tasks`);
    expect(tasks.status).toBe(200);
    expect(tasks.body.data).toHaveLength(1);
    expect(tasks.body.data[0].id).toBe(grandchild.id);
    expect(tasks.body.data[0].parent_task_id).toBeNull();
    expect(tasks.body.data[0].is_subtask).toBe(true);
  });
});
