const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
  bcrypt.compare.mockResolvedValue(true);
});

beforeEach(async () => {
  await testDb('owner_account').del();
  await testDb('contracts').del();
  await testDb('user_attributes').del();
  await testDb('role_attributes').del();
  await testDb('user_roles').del();
  await testDb('task_assignment').del();
  await testDb('tasks').del();
  await testDb('projects').del();
  await testDb('users').del();

  const response = await request(app)
    .post('/api/auth/bootstrap-owner')
    .send({
      name: 'Studio Owner',
      email: 'owner@example.com',
      phone_number: '5550100',
      password: 'password',
      setup_secret: setupSecret
    });
  expect(response.status).toBe(201);

  ownerAgent = request.agent(app);
  await ownerAgent.post('/api/auth/login').send({
    email: 'owner@example.com',
    password: 'password'
  });
});

afterAll(async () => {
  delete process.env.OWNER_SETUP_SECRET;
  await knex.destroy();
});

describe('Owner-managed authorization model', () => {
  test('bootstraps exactly one owner and protects administration endpoints', async () => {
    const invalidSetup = await request(app)
      .post('/api/auth/bootstrap-owner')
      .send({
        name: 'Attacker',
        email: 'attacker@example.com',
        phone_number: '5550104',
        password: 'password',
        setup_secret: 'incorrect-setup-secret'
      });
    expect(invalidSetup.status).toBe(403);

    const secondBootstrap = await request(app)
      .post('/api/auth/bootstrap-owner')
      .send({
        name: 'Second Owner',
        email: 'second-owner@example.com',
        phone_number: '5550101',
        password: 'password',
        setup_secret: setupSecret
      });
    expect(secondBootstrap.status).toBe(409);
    expect(await testDb('owner_account').count({ count: '*' }).first()).toMatchObject({ count: 1 });

    const ownerResponse = await ownerAgent.get('/api/admin/roles');
    expect(ownerResponse.status).toBe(200);
    const ownerAccount = await testDb('owner_account').where({ id: 1 }).first();
    const ownerArchive = await ownerAgent.patch(`/api/admin/people/${ownerAccount.user_id}`)
      .send({ is_active: false });
    expect(ownerArchive.status).toBe(400);

    await testDb('users').insert({
      name: 'Unprivileged Person',
      email: 'person@example.com',
      phone_number: '5550102',
      password: '$2a$10$hashedpassword',
      is_active: true
    });
    const person = await testDb('users').where({ email: 'person@example.com' }).first();
    const personAgent = request.agent(app);
    await personAgent.post('/api/auth/login').send({
      email: person.email,
      password: 'password'
    });

    const denied = await personAgent.get('/api/admin/people');
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Owner access required');

    const archived = await ownerAgent.patch(`/api/admin/people/${person.id}`)
      .send({ is_active: false });
    expect(archived.status).toBe(200);
    const archivedSession = await personAgent.get('/api/admin/people');
    expect(archivedSession.status).toBe(401);

    await testDb('users').insert({
      name: 'Passwordless Person',
      email: 'passwordless@example.com',
      phone_number: '5550105',
      password: null,
      is_active: true
    });
    const passwordlessLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'passwordless@example.com' });
    expect(passwordlessLogin.status).toBe(401);
  });

  test('grants project access through a project-scoped role assignment and denies other projects', async () => {
    const firstProject = await ownerAgent.post('/api/projects').send({ name: 'Project One' });
    const secondProject = await ownerAgent.post('/api/projects').send({ name: 'Project Two' });
    expect(firstProject.status).toBe(201);
    expect(secondProject.status).toBe(201);

    const roleResponse = await ownerAgent.post('/api/admin/roles').send({ name: 'project-manager' });
    const attributeResponse = await ownerAgent.post('/api/admin/attributes').send({
      name: 'is_project_manager',
      resource: 'project'
    });
    expect(roleResponse.status).toBe(201);
    expect(attributeResponse.status).toBe(201);

    const personResponse = await ownerAgent.post('/api/admin/people')
      .field('name', 'Project Manager')
      .field('email', 'manager@example.com')
      .field('phone_number', '5550103')
      .field('password', 'password')
      .field('contract_start_date', '2026-01-01')
      .field('contract_end_date', '2027-01-01')
      .field('roles', JSON.stringify([{
        name: 'project-manager',
        resourceType: 'project',
        resourceId: firstProject.body.project.id
      }]))
      .attach(
        'contract',
        Buffer.from('%PDF-1.7\nTest contract\n%%EOF'),
        { filename: 'manager.pdf', contentType: 'application/pdf' }
      );
    expect(personResponse.status).toBe(201);
    const scopedAssignment = await ownerAgent.put(
      `/api/admin/people/${personResponse.body.person.id}/roles`
    ).send({
      roles: [{
        name: 'project-manager',
        resourceType: 'project',
        resourceId: firstProject.body.project.id
      }]
    });
    expect(scopedAssignment.status).toBe(200);
    expect(scopedAssignment.body.roles).toEqual([{
      name: 'project-manager',
      resourceType: 'project',
      resourceId: firstProject.body.project.id
    }]);

    const assigned = await ownerAgent.put(
      `/api/admin/roles/${roleResponse.body.role.id}/attributes`
    ).send({
      attributes: [{
        attributeId: attributeResponse.body.attribute.id
      }]
    });
    expect(assigned.status).toBe(200);

    const readPermission = await testDb('permissions')
      .where({ action: 'read', resource: 'project' })
      .first();
    const configured = await ownerAgent.put(
      `/api/admin/permissions/${readPermission.id}/grants`
    ).send({
      alternatives: [[attributeResponse.body.attribute.id]]
    });
    expect(configured.status).toBe(200);
    let readTaskPermission = await testDb('permissions')
      .where({ action: 'read', resource: 'task' })
      .first();
    if (!readTaskPermission) {
      const createdPermission = await ownerAgent.post('/api/admin/permissions').send({
        action: 'read',
        resource: 'task'
      });
      expect(createdPermission.status).toBe(201);
      readTaskPermission = createdPermission.body.permission;
    }
    const taskReadConfigured = await ownerAgent.put(
      `/api/admin/permissions/${readTaskPermission.id}/grants`
    ).send({
      alternatives: [[attributeResponse.body.attribute.id]]
    });
    expect(taskReadConfigured.status).toBe(200);
    await ownerAgent.put(
      `/api/projects/${firstProject.body.project.id}/members/${personResponse.body.person.id}`
    ).send({ departmentId: null });
    const firstProjectTask = await ownerAgent.post(
      `/api/projects/${firstProject.body.project.id}/tasks`
    ).send({ title: 'Project-scoped task' });
    const secondProjectTask = await ownerAgent.post(
      `/api/projects/${secondProject.body.project.id}/tasks`
    ).send({ title: 'Other project task' });
    expect(firstProjectTask.status).toBe(201);
    expect(secondProjectTask.status).toBe(201);

    const managerAgent = request.agent(app);
    const managerLogin = await managerAgent.post('/api/auth/login').send({
      email: 'manager@example.com',
      password: 'password'
    });
    expect(managerLogin.body.user.roles).toEqual(['project-manager']);
    expect(managerLogin.body.user.roleAssignments).toEqual([{
      name: 'project-manager',
      resourceType: 'project',
      resourceId: firstProject.body.project.id
    }]);
    const visibleProjects = await managerAgent.get('/api/projects');
    expect(visibleProjects.status).toBe(200);
    expect(visibleProjects.body.projects.map(project => project.id)).toEqual([
      firstProject.body.project.id
    ]);

    const firstProjectAccess = await managerAgent.get(
      `/api/projects/${firstProject.body.project.id}`
    );
    const secondProjectAccess = await managerAgent.get(
      `/api/projects/${secondProject.body.project.id}`
    );
    expect(firstProjectAccess.status).toBe(200);
    expect(secondProjectAccess.status).toBe(403);
    const firstProjectTasks = await managerAgent.get(
      `/api/projects/${firstProject.body.project.id}/tasks`
    );
    const secondProjectTasks = await managerAgent.get(
      `/api/projects/${secondProject.body.project.id}/tasks`
    );
    expect(firstProjectTasks.status).toBe(200);
    expect(firstProjectTasks.body.data.map(task => task.id)).toContain(firstProjectTask.body.data.id);
    expect(secondProjectTasks.status).toBe(403);
    const deniedTaskCreate = await managerAgent.post(
      `/api/projects/${firstProject.body.project.id}/tasks`
    ).send({ title: 'Manager cannot create without permission' });
    const deniedTaskUpdate = await managerAgent.patch(
      `/api/projects/${firstProject.body.project.id}/tasks/${firstProjectTask.body.data.id}`
    ).send({ title: 'Manager cannot update without permission' });
    const deniedTaskDelete = await managerAgent.delete(
      `/api/projects/${firstProject.body.project.id}/tasks/${firstProjectTask.body.data.id}`
    );
    expect([
      deniedTaskCreate.status,
      deniedTaskUpdate.status,
      deniedTaskDelete.status
    ]).toEqual([403, 403, 403]);

    const unauthenticatedTaskList = await request(app).get(
      `/api/projects/${firstProject.body.project.id}/tasks`
    );
    const unauthenticatedTaskCreate = await request(app).post(
      `/api/projects/${firstProject.body.project.id}/tasks`
    ).send({ title: 'Anonymous task' });
    const unauthenticatedTaskUpdate = await request(app).patch(
      `/api/projects/${firstProject.body.project.id}/tasks/${firstProjectTask.body.data.id}`
    ).send({ title: 'Anonymous update' });
    const unauthenticatedTaskDelete = await request(app).delete(
      `/api/projects/${firstProject.body.project.id}/tasks/${firstProjectTask.body.data.id}`
    );
    expect([
      unauthenticatedTaskList.status,
      unauthenticatedTaskCreate.status,
      unauthenticatedTaskUpdate.status,
      unauthenticatedTaskDelete.status
    ]).toEqual([401, 401, 401, 401]);
  });
});
