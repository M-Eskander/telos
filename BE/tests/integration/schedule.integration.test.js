const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const accessPresetsSeed = require('../../src/db/seeds/access_presets_seed');
const pdpService = require('../../src/services/pdp.service');
const { computeSchedule, relativeDay, attentionFor } = require('../../src/services/schedule.service');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;

const day = (offset) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

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
    builder = builder.field(field, value === null ? '' : String(value));
  }
  const response = await builder.attach(
    'contract',
    Buffer.from('%PDF-1.7\nTest contract\n%%EOF'),
    { filename: 'contract.pdf', contentType: 'application/pdf' }
  );
  if (response.status === 201) {
    await testDb('users').where({ id: response.body.person.id }).update({ email_verified_at: new Date() });
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
  await testDb('task_dependencies').del();
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
  await testDb('users').where({ id: bootstrap.body.user.id }).update({ email_verified_at: Date.now() });
  ownerAgent = await login('owner@example.com');
});

afterAll(async () => {
  delete process.env.OWNER_SETUP_SECRET;
  await knex.destroy();
});

async function createProject(name = 'Schedule Project') {
  const response = await ownerAgent.post('/api/projects').send({ name });
  expect(response.status).toBe(201);
  return response.body.project;
}

describe('Schedule health', () => {
  test('classifies a task by its dates and progress', () => {
    expect(computeSchedule({ progress: 100, end_date: day(-5) }).state).toBe('done');
    expect(computeSchedule({ progress: 20, end_date: day(-3) }).state).toBe('overdue');
    expect(computeSchedule({ progress: 20, end_date: day(2) }).state).toBe('due_soon');
    expect(computeSchedule({ progress: 20, end_date: day(60) }).state).toBe('on_track');
    expect(computeSchedule({ progress: 20 }).state).toBe('no_date');
  });

  test('calls a task at risk when the progress is behind the calendar', () => {
    const task = { progress: 10, start_date: day(-20), end_date: day(20) };
    expect(computeSchedule(task).state).toBe('at_risk');
  });

  test('describes dates in relative terms', () => {
    const now = new Date('2026-06-15T00:00:00');
    expect(relativeDay('2026-06-15', now)).toBe('today');
    expect(relativeDay('2026-06-16', now)).toBe('tomorrow');
    expect(relativeDay('2026-06-20', now)).toBe('in 5 days');
    expect(relativeDay('2026-06-10', now)).toBe('5 days late');
  });

  test('groups the work that needs attention', () => {
    const tasks = [
      { id: 1, title: 'Late', progress: 10, end_date: day(-2), assignees: [{ id: 7 }], updated_at: new Date() },
      { id: 2, title: 'Soon', progress: 0, end_date: day(1), assignees: [{ id: 7 }], updated_at: new Date() },
      { id: 3, title: 'Free', progress: 0, end_date: day(30), assignees: [], updated_at: new Date() },
      { id: 4, title: 'Stale', progress: 30, end_date: day(30), assignees: [{ id: 7 }], updated_at: new Date(Date.now() - 9 * 86400000) },
      { id: 5, title: 'Waiting', progress: 0, end_date: day(30), assignees: [{ id: 7 }], depends_on: [6], updated_at: new Date() },
      { id: 6, title: 'Prerequisite', progress: 0, end_date: day(40), assignees: [{ id: 7 }], updated_at: new Date() }
    ];
    const buckets = attentionFor(tasks, { userId: 7 });
    expect(buckets.overdue.map(t => t.id)).toEqual([1]);
    expect(buckets.due_soon.map(t => t.id)).toEqual([2]);
    expect(buckets.unassigned.map(t => t.id)).toEqual([3]);
    expect(buckets.stale.map(t => t.id)).toEqual([4]);
    expect(buckets.blocked.map(t => t.id)).toEqual([5]);
  });
});

describe('Schedule API', () => {
  test('a task list carries its schedule state and relative due date', async () => {
    const project = await createProject();
    await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Late task', end_date: day(-2), progress: 30 });

    const response = await ownerAgent.get(`/api/projects/${project.id}/tasks`);
    expect(response.status).toBe(200);
    const task = response.body.data[0];
    expect(task.schedule.state).toBe('overdue');
    expect(task.schedule.severity).toBe(3);
    expect(task.due.relative).toMatch(/late/);
  });

  test('the attention view groups what needs a person', async () => {
    const project = await createProject();
    await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Late task', end_date: day(-2), progress: 30 });

    const response = await ownerAgent.get(`/api/projects/${project.id}/attention`);
    expect(response.status).toBe(200);
    expect(response.body.attention.overdue).toHaveLength(1);
    expect(response.body.attention.overdue[0].title).toBe('Late task');
  });

  test('the project list carries a health summary', async () => {
    const project = await createProject();
    await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Late task', end_date: day(-2), progress: 30 });

    const response = await ownerAgent.get('/api/projects');
    expect(response.status).toBe(200);
    const summary = response.body.projects.find(item => item.id === project.id).summary;
    expect(summary.overdue).toBe(1);
    expect(summary.total).toBe(1);
  });

  test('a task can be moved to a new parent and position', async () => {
    const project = await createProject();
    const first = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'First' });
    const second = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'Second' });
    const child = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Child', parent_task_id: first.body.data.id });

    const moved = await ownerAgent.patch(
      `/api/projects/${project.id}/tasks/${child.body.data.id}/move`
    ).send({ parent_task_id: second.body.data.id, position: 0 });
    expect(moved.status).toBe(200);
    expect(moved.body.data.parent_task_id).toBe(second.body.data.id);

    const listed = await ownerAgent.get(`/api/projects/${project.id}/tasks`);
    const secondNode = listed.body.data.find(task => task.id === second.body.data.id);
    expect(secondNode.subtasks[0].id).toBe(child.body.data.id);
  });

  test('a task cannot be moved under its own subtask', async () => {
    const project = await createProject();
    const parent = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'Parent' });
    const child = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Child', parent_task_id: parent.body.data.id });

    const moved = await ownerAgent.patch(
      `/api/projects/${project.id}/tasks/${parent.body.data.id}/move`
    ).send({ parent_task_id: child.body.data.id });
    expect(moved.status).toBe(400);
  });

  test('many tasks can be changed at once', async () => {
    const project = await createProject();
    const a = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'A' });
    const b = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'B' });

    const response = await ownerAgent.patch(`/api/projects/${project.id}/tasks/bulk`)
      .send({ ids: [a.body.data.id, b.body.data.id], weight: 9 });
    expect(response.status).toBe(200);

    const listed = await ownerAgent.get(`/api/projects/${project.id}/tasks`);
    expect(listed.body.data.map(task => task.weight).sort()).toEqual([9, 9]);
    expect(listed.body.data[0].priority).toBe('high');
  });

  test('dependencies can be set and are reported back', async () => {
    const project = await createProject();
    const a = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'A' });
    const b = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'B' });

    const response = await ownerAgent.put(
      `/api/projects/${project.id}/tasks/${b.body.data.id}/dependencies`
    ).send({ depends_on: [a.body.data.id] });
    expect(response.status).toBe(200);
    expect(response.body.data.depends_on).toEqual([a.body.data.id]);
  });

  test('a task cannot depend on itself', async () => {
    const project = await createProject();
    const a = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({ title: 'A' });
    const response = await ownerAgent.put(
      `/api/projects/${project.id}/tasks/${a.body.data.id}/dependencies`
    ).send({ depends_on: [a.body.data.id] });
    expect(response.status).toBe(400);
  });
});
