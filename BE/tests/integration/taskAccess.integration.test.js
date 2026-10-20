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
    builder = builder.field(field, value === null ? '' : String(value));
  }
  const response = await builder.attach(
    'contract',
    Buffer.from('%PDF-1.7\nTest contract\n%%EOF'),
    { filename: 'contract.pdf', contentType: 'application/pdf' }
  );
  if (response.status === 201) {
    await testDb('users')
      .where({ id: response.body.person.id })
      .update({ email_verified_at: new Date() });
  }
  return response;
}

async function addProjectRole(personId, roleName, projectId) {
  const response = await ownerAgent.put(`/api/admin/people/${personId}/roles`).send({
    roles: [{
      name: roleName,
      resourceType: 'project',
      resourceId: projectId
    }]
  });
  expect(response.status).toBe(200);
  return response;
}

function login(email) {
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

async function createProject() {
  const response = await ownerAgent.post('/api/projects').send({ name: 'Access Test Project' });
  expect(response.status).toBe(201);
  return response.body.project;
}

describe('Built-in project access presets', () => {
  test('creates a role with a preset and grants project-scoped access', async () => {
    const project = await createProject();
    const role = await ownerAgent.post('/api/admin/roles').send({
      name: 'Creative Director',
      preset: 'project_manager'
    });
    expect(role.status).toBe(201);
    expect(role.body.role.accessPreset).toBe('project_manager');
    expect(role.body.role.attributes).toEqual([
      expect.objectContaining({ name: 'project_manager', resource: 'project' })
    ]);

    const person = await createPerson({ email: 'creative@example.com' });
    expect(person.status).toBe(201);
    await ownerAgent.put(`/api/projects/${project.id}/members/${person.body.person.id}`)
      .send({ departmentId: null });
    const globalAssignment = await ownerAgent.put(
      `/api/admin/people/${person.body.person.id}/roles`
    ).send({ roles: [{ name: 'Creative Director' }] });
    expect(globalAssignment.status).toBe(400);
    await addProjectRole(person.body.person.id, 'Creative Director', project.id);

    const memberAgent = await login('creative@example.com');
    const projects = await memberAgent.get('/api/projects');
    expect(projects.status).toBe(200);
    expect(projects.body.projects.map(item => item.id)).toEqual([project.id]);
    const access = await memberAgent.get(`/api/projects/${project.id}`);
    expect(access.status).toBe(200);
    expect(access.body.project.permissions).toEqual(expect.arrayContaining([
      'read:project',
      'read:task',
      'create:task',
      'manage:task'
    ]));
    expect(access.body.project.permissions).not.toContain('delete:project');
  });

  test('team members see every task but may only update progress on assigned tasks', async () => {
    const project = await createProject();
    const role = await ownerAgent.post('/api/admin/roles').send({
      name: 'Team Member Access',
      preset: 'project_member'
    });
    expect(role.status).toBe(201);
    const person = await createPerson({ email: 'team-member@example.com' });
    const membership = await ownerAgent.put(
      `/api/projects/${project.id}/members/${person.body.person.id}`
    ).send({ departmentId: null });
    expect(membership.status).toBe(200);
    await addProjectRole(person.body.person.id, 'Team Member Access', project.id);

    const assigned = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Assigned task', assignee_ids: [person.body.person.id] });
    const unassigned = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Other task' });
    expect(assigned.status).toBe(201);
    expect(unassigned.status).toBe(201);

    const memberAgent = await login('team-member@example.com');
    const tasks = await memberAgent.get(`/api/projects/${project.id}/tasks`);
    expect(tasks.status).toBe(200);
    expect(tasks.body.data.map(task => task.id).sort()).toEqual([
      assigned.body.data.id,
      unassigned.body.data.id
    ].sort());
    const team = await memberAgent.get(`/api/projects/${project.id}/members`);
    expect(team.status).toBe(200);

    const progress = await memberAgent.patch(
      `/api/projects/${project.id}/tasks/${assigned.body.data.id}`
    ).send({ progress: 55 });
    expect(progress.status).toBe(200);
    expect(progress.body.data.progress).toBe(55);

    const title = await memberAgent.patch(
      `/api/projects/${project.id}/tasks/${assigned.body.data.id}`
    ).send({ title: 'Nope' });
    expect(title.status).toBe(403);

    const otherTask = await memberAgent.patch(
      `/api/projects/${project.id}/tasks/${unassigned.body.data.id}`
    ).send({ progress: 10 });
    expect(otherTask.status).toBe(403);
  });

  test('low-access members see only assigned tasks and can update their progress', async () => {
    const project = await createProject();
    const role = await ownerAgent.post('/api/admin/roles').send({
      name: 'Limited Access',
      preset: 'project_limited'
    });
    expect(role.status).toBe(201);
    const person = await createPerson({ email: 'limited@example.com' });
    await ownerAgent.put(`/api/projects/${project.id}/members/${person.body.person.id}`)
      .send({ departmentId: null });
    await addProjectRole(person.body.person.id, 'Limited Access', project.id);

    const assigned = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({
        title: 'My assigned task',
        assignee_ids: [person.body.person.id],
        start_date: '2026-02-01',
        end_date: '2026-02-10'
      });
    const unassigned = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Not mine' });
    const assignedSubtask = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({
        title: 'My assigned subtask',
        parent_task_id: unassigned.body.data.id,
        assignee_ids: [person.body.person.id]
      });
    expect(assigned.status).toBe(201);
    expect(unassigned.status).toBe(201);
    expect(assignedSubtask.status).toBe(201);

    const memberAgent = await login('limited@example.com');
    const tasks = await memberAgent.get(`/api/projects/${project.id}/tasks`);
    expect(tasks.status).toBe(200);
    expect(tasks.body.data.map(task => task.id).sort()).toEqual([
      assigned.body.data.id,
      assignedSubtask.body.data.id
    ].sort());
    expect(tasks.body.data.map(task => task.id)).not.toContain(unassigned.body.data.id);
    expect(tasks.body.data.find(task => task.id === assignedSubtask.body.data.id)).toMatchObject({
      parent_task_id: null,
      is_subtask: true
    });
    const team = await memberAgent.get(`/api/projects/${project.id}/members`);
    expect(team.status).toBe(403);
    const timeline = await memberAgent.get(`/api/projects/${project.id}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.tasks.map(task => task.id)).toEqual([assigned.body.data.id]);

    const progress = await memberAgent.patch(
      `/api/projects/${project.id}/tasks/${assigned.body.data.id}`
    ).send({ progress: 70 });
    expect(progress.status).toBe(200);
    expect(progress.body.data.progress).toBe(70);

    const hidden = await memberAgent.patch(
      `/api/projects/${project.id}/tasks/${unassigned.body.data.id}`
    ).send({ progress: 10 });
    expect(hidden.status).toBe(403);
  });

  test('project managers manage tasks and the team, but cannot change project settings or delete the project', async () => {
    const project = await createProject();
    const role = await ownerAgent.post('/api/admin/roles').send({
      name: 'Manager Access',
      preset: 'project_manager'
    });
    expect(role.status).toBe(201);
    const person = await createPerson({ email: 'manager-access@example.com' });
    const candidate = await createPerson({ email: 'manager-candidate@example.com' });
    await ownerAgent.put(`/api/projects/${project.id}/members/${person.body.person.id}`)
      .send({ departmentId: null });
    await addProjectRole(person.body.person.id, 'Manager Access', project.id);
    const memberAgent = await login('manager-access@example.com');

    const created = await memberAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'Manager-created task' });
    expect(created.status).toBe(201);
    const edited = await memberAgent.patch(
      `/api/projects/${project.id}/tasks/${created.body.data.id}`
    ).send({ title: 'Manager-edited task', status: 'done' });
    expect(edited.status).toBe(200);
    const projectEdit = await memberAgent.patch(`/api/projects/${project.id}`)
      .send({ name: 'Renamed' });
    expect(projectEdit.status).toBe(403);
    const candidates = await memberAgent.get(`/api/projects/${project.id}/available-people`);
    expect(candidates.status).toBe(200);
    expect(candidates.body.people.map(item => item.id)).toContain(candidate.body.person.id);
    const addCandidate = await memberAgent.put(
      `/api/projects/${project.id}/members/${candidate.body.person.id}`
    ).send({ departmentId: null });
    expect(addCandidate.status).toBe(200);
    const projectDelete = await memberAgent.delete(`/api/projects/${project.id}`);
    expect(projectDelete.status).toBe(403);
  });

  test('owner-like project admins manage the project but cannot delete it', async () => {
    const project = await createProject();
    const role = await ownerAgent.post('/api/admin/roles').send({
      name: 'Admin Access',
      preset: 'project_admin'
    });
    expect(role.status).toBe(201);
    const person = await createPerson({ email: 'project-admin@example.com' });
    await ownerAgent.put(`/api/projects/${project.id}/members/${person.body.person.id}`)
      .send({ departmentId: null });
    await addProjectRole(person.body.person.id, 'Admin Access', project.id);
    const memberAgent = await login('project-admin@example.com');

    const projectEdit = await memberAgent.patch(`/api/projects/${project.id}`)
      .send({ name: 'Admin-renamed project' });
    expect(projectEdit.status).toBe(200);
    const projectDelete = await memberAgent.delete(`/api/projects/${project.id}`);
    expect(projectDelete.status).toBe(403);
  });
});
