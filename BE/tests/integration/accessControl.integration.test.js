const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const taskRepository = require('../../src/repositories/task.repo');
const app = require('../../src/app');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;

async function createPerson(agent, overrides = {}) {
  return agent.post('/api/admin/people').send({
    name: 'Test Person',
    email: 'person@example.com',
    phone_number: '5550100',
    password: 'password',
    ...overrides
  });
}

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await testDb('owner_account').del();
  await testDb('permission_attributes').del();
  await testDb('permission_grant_groups').del();
  await testDb('user_attributes').del();
  await testDb('role_attributes').del();
  await testDb('user_roles').del();
  await testDb('task_assignment').del();
  await testDb('tasks').del();
  await testDb('projects').del();
  await testDb('users').del();

  const bootstrap = await request(app).post('/api/auth/bootstrap-owner').send({
    name: 'Studio Owner',
    email: 'owner@example.com',
    phone_number: '5550199',
    password: 'password',
    setup_secret: setupSecret
  });
  expect(bootstrap.status).toBe(201);
  ownerAgent = request.agent(app);
  const login = await ownerAgent.post('/api/auth/login').send({
    email: 'owner@example.com',
    password: 'password'
  });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  delete process.env.OWNER_SETUP_SECRET;
  await knex.destroy();
});

describe('Access-control administration API', () => {
  test('supports listing, creating, reading, updating, and archiving people', async () => {
    const role = await ownerAgent.post('/api/admin/roles').send({ name: 'editor' });
    expect(role.status).toBe(201);

    const created = await createPerson(ownerAgent, {
      name: 'Editor',
      email: 'editor@example.com',
      roles: ['editor'],
      age: 31,
      location: 'London'
    });
    expect(created.status).toBe(201);
    expect(created.body.person).toMatchObject({
      name: 'Editor',
      email: 'editor@example.com',
      age: 31,
      location: 'London',
      is_active: 1,
      roles: ['editor'],
      roleAssignments: [{ name: 'editor', resourceType: null, resourceId: null }]
    });
    expect(created.body.person.password).toBeUndefined();

    const listed = await ownerAgent.get('/api/admin/people');
    expect(listed.status).toBe(200);
    expect(listed.body.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'editor@example.com', isOwner: false })
    ]));

    const personId = created.body.person.id;
    const details = await ownerAgent.get(`/api/admin/people/${personId}`);
    expect(details.status).toBe(200);
    expect(details.body.person).toMatchObject({
      roles: [expect.objectContaining({ name: 'editor' })],
      attributes: []
    });

    const updated = await ownerAgent.patch(`/api/admin/people/${personId}`)
      .send({ name: 'Updated Editor', age: null, is_active: false, password: 'ignored' });
    expect(updated.status).toBe(200);
    expect(updated.body.person).toMatchObject({
      name: 'Updated Editor',
      age: null,
      is_active: 0
    });
    expect(updated.body.person.password).toBeUndefined();
    expect((await testDb('users').where({ id: personId }).first()).password)
      .toBe('$2a$10$testHashedPassword');
    expect((await ownerAgent.get(`/api/admin/people/${personId}`)).status).toBe(200);

    const archivedLogin = await request(app).post('/api/auth/login')
      .send({ email: 'editor@example.com', password: 'password' });
    expect(archivedLogin.status).toBe(401);
    const owner = await testDb('owner_account').first();
    const ownerArchive = await ownerAgent.patch(`/api/admin/people/${owner.user_id}`)
      .send({ is_active: false });
    expect(ownerArchive.status).toBe(400);
    expect(ownerArchive.body.message).toBe('The owner account cannot be archived');

    const missing = await ownerAgent.get('/api/admin/people/99999');
    expect(missing.status).toBe(404);
    const missingUpdate = await ownerAgent.patch('/api/admin/people/99999').send({ name: 'Nope' });
    expect(missingUpdate.status).toBe(404);
    const missingRoles = await ownerAgent.put('/api/admin/people/99999/roles').send({ roles: [] });
    expect(missingRoles.status).toBe(404);
    const missingAttributes = await ownerAgent.put('/api/admin/people/99999/attributes')
      .send({ attributes: [] });
    expect(missingAttributes.status).toBe(404);
  });

  test('validates people and role assignments without persisting invalid input', async () => {
    const noRequiredFields = await ownerAgent.post('/api/admin/people').send({});
    expect(noRequiredFields.status).toBe(400);
    const wrongFieldType = await createPerson(ownerAgent, { name: 7 });
    expect(wrongFieldType.status).toBe(400);
    const invalidAge = await createPerson(ownerAgent, { age: -1 });
    expect(invalidAge.status).toBe(400);
    const invalidActive = await createPerson(ownerAgent, { is_active: 'false' });
    expect(invalidActive.status).toBe(400);
    const duplicateEmail = await createPerson(ownerAgent, { email: 'owner@example.com' });
    expect(duplicateEmail.status).toBe(409);

    const base = await createPerson(ownerAgent, { email: 'roles@example.com' });
    expect(base.status).toBe(201);
    const id = base.body.person.id;
    const malformedRoles = await ownerAgent.put(`/api/admin/people/${id}/roles`).send({ roles: 'editor' });
    expect(malformedRoles.status).toBe(400);
    const unknownRole = await ownerAgent.put(`/api/admin/people/${id}/roles`).send({
      roles: ['missing-role']
    });
    expect(unknownRole.status).toBe(400);
    const reservedRole = await ownerAgent.put(`/api/admin/people/${id}/roles`).send({
      roles: ['owner']
    });
    expect(reservedRole.status).toBe(400);
    const duplicateRoles = await ownerAgent.put(`/api/admin/people/${id}/roles`).send({
      roles: ['user', 'user']
    });
    expect(duplicateRoles.status).toBe(400);
    const mismatchedScope = await ownerAgent.put(`/api/admin/people/${id}/roles`).send({
      roles: [{ name: 'user', resourceType: 'project' }]
    });
    expect(mismatchedScope.status).toBe(400);
    const missingScopeProject = await ownerAgent.put(`/api/admin/people/${id}/roles`).send({
      roles: [{ name: 'user', resourceType: 'project', resourceId: 99999 }]
    });
    expect(missingScopeProject.status).toBe(400);

    const invalidUpdate = await ownerAgent.patch(`/api/admin/people/${id}`)
      .send({ is_active: 'no', age: -4 });
    expect(invalidUpdate.status).toBe(400);
    const unchanged = await ownerAgent.get(`/api/admin/people/${id}`);
    expect(unchanged.body.person).toMatchObject({ is_active: 1, age: null, roles: [] });

    const noAuth = await request(app).get('/api/admin/people');
    expect(noAuth.status).toBe(401);
    const person = await createPerson(ownerAgent, { email: 'non-owner@example.com' });
    const personAgent = request.agent(app);
    await personAgent.post('/api/auth/login').send({
      email: person.body.person.email,
      password: 'password'
    });
    const forbidden = await personAgent.get('/api/admin/people');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.message).toBe('Owner access required');
  });

  test('manages roles, attributes, and scoped person and role attributes', async () => {
    const project = await ownerAgent.post('/api/projects').send({ name: 'Scoped Project' });
    expect(project.status).toBe(201);

    const roleList = await ownerAgent.get('/api/admin/roles');
    expect(roleList.status).toBe(200);
    const role = await ownerAgent.post('/api/admin/roles').send({ name: 'scoped-editor' });
    expect(role.status).toBe(201);
    expect((await ownerAgent.post('/api/admin/roles').send({ name: 'scoped-editor' })).status).toBe(409);
    expect((await ownerAgent.post('/api/admin/roles').send({ name: 'owner' })).status).toBe(400);
    expect((await ownerAgent.post('/api/admin/roles').send({ name: '  ' })).status).toBe(400);

    const globalAttribute = await ownerAgent.post('/api/admin/attributes').send({
      name: 'can_review',
      resource: 'global',
      description: 'Review access'
    });
    const projectAttribute = await ownerAgent.post('/api/admin/attributes').send({
      name: 'can_edit_project',
      resource: 'project'
    });
    expect(globalAttribute.status).toBe(201);
    expect(projectAttribute.status).toBe(201);
    expect((await ownerAgent.post('/api/admin/attributes').send({
      name: 'can_review',
      resource: 'global'
    })).status).toBe(409);
    expect((await ownerAgent.post('/api/admin/attributes').send({
      name: '',
      resource: 'project'
    })).status).toBe(400);
    expect((await ownerAgent.get('/api/admin/attributes')).status).toBe(200);

    const person = await createPerson(ownerAgent, {
      email: 'scoped@example.com',
      roles: [{
        name: 'scoped-editor',
        resourceType: 'project',
        resourceId: project.body.project.id
      }]
    });
    expect(person.status).toBe(201);
    const personId = person.body.person.id;
    const scopedRole = await ownerAgent.put(`/api/admin/people/${personId}/roles`).send({
      roles: [{
        name: 'scoped-editor',
        resourceType: 'project',
        resourceId: project.body.project.id
      }]
    });
    expect(scopedRole.status).toBe(200);
    expect(scopedRole.body.roles).toEqual([{
      name: 'scoped-editor',
      resourceType: 'project',
      resourceId: project.body.project.id
    }]);

    const personAttr = await ownerAgent.put(`/api/admin/people/${personId}/attributes`).send({
      attributes: [
        { attributeId: globalAttribute.body.attribute.id },
        { attributeId: projectAttribute.body.attribute.id, resourceId: project.body.project.id, mode: 'remove' }
      ]
    });
    expect(personAttr.status).toBe(200);
    expect(personAttr.body.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributeId: globalAttribute.body.attribute.id, resourceId: null }),
      expect.objectContaining({ attributeId: projectAttribute.body.attribute.id, resourceId: project.body.project.id, mode: 'remove' })
    ]));
    const persistedPersonAttributes = await testDb('user_attributes')
      .where({ user_id: personId })
      .select('attribute_id', 'mode');
    expect(persistedPersonAttributes).toEqual(expect.arrayContaining([
      { attribute_id: globalAttribute.body.attribute.id, mode: 'add' },
      { attribute_id: projectAttribute.body.attribute.id, mode: 'remove' }
    ]));

    const roleAttr = await ownerAgent.put(`/api/admin/roles/${role.body.role.id}/attributes`).send({
      attributes: [{ attributeId: projectAttribute.body.attribute.id, resourceId: project.body.project.id }]
    });
    expect(roleAttr.status).toBe(200);
    expect(roleAttr.body.attributes).toEqual([
      expect.objectContaining({
        attributeId: projectAttribute.body.attribute.id,
        resourceId: project.body.project.id
      })
    ]);
    const roleDetails = await ownerAgent.get(`/api/admin/roles/${role.body.role.id}`);
    expect(roleDetails.status).toBe(200);
    expect(roleDetails.body.role.attributes).toEqual([
      expect.objectContaining({ name: 'can_edit_project', resourceId: project.body.project.id })
    ]);

    expect((await ownerAgent.put(`/api/admin/people/${personId}/attributes`).send({
      attributes: []
    })).status).toBe(200);
    expect((await ownerAgent.put(`/api/admin/roles/${role.body.role.id}/attributes`).send({
      attributes: []
    })).status).toBe(200);
    expect((await ownerAgent.get('/api/admin/roles/99999')).status).toBe(404);
    expect((await ownerAgent.put('/api/admin/roles/99999/attributes').send({
      attributes: []
    })).status).toBe(404);
  });

  test('rejects malformed, duplicate, unsupported, and out-of-scope attribute assignments', async () => {
    const person = await createPerson(ownerAgent, { email: 'attributes@example.com' });
    const role = await ownerAgent.post('/api/admin/roles').send({ name: 'attribute-holder' });
    const global = await ownerAgent.post('/api/admin/attributes').send({
      name: 'global_permission',
      resource: 'global'
    });
    const project = await ownerAgent.post('/api/admin/attributes').send({
      name: 'project_permission',
      resource: 'project'
    });
    const unsupported = await ownerAgent.post('/api/admin/attributes').send({
      name: 'custom_permission',
      resource: 'custom'
    });
    const personPath = `/api/admin/people/${person.body.person.id}/attributes`;
    const rolePath = `/api/admin/roles/${role.body.role.id}/attributes`;

    for (const [path, payload] of [
      [personPath, { attributes: 'bad' }],
      [personPath, { attributes: [null] }],
      [personPath, { attributes: [{ attributeId: 0 }] }],
      [personPath, { attributes: [{ attributeId: 99999 }] }],
      [personPath, { attributes: [{ attributeId: global.body.attribute.id, resourceId: 1 }] }],
      [personPath, { attributes: [{ attributeId: project.body.attribute.id, resourceId: 99999 }] }],
      [personPath, { attributes: [{ attributeId: unsupported.body.attribute.id, resourceId: 1 }] }],
      [personPath, { attributes: [{ attributeId: global.body.attribute.id, mode: 'invalid' }] }],
      [personPath, { attributes: [
        { attributeId: global.body.attribute.id },
        { attributeId: global.body.attribute.id, resourceId: null }
      ] }],
      [rolePath, { attributes: [{ attributeId: project.body.attribute.id, resourceId: -1 }] }]
    ]) {
      const response = await ownerAgent.put(path).send(payload);
      expect(response.status).toBe(400);
    }

    const personAfterFailures = await ownerAgent.get(personPath.replace('/attributes', ''));
    expect(personAfterFailures.body.person.attributes).toEqual([]);
    const roleAfterFailures = await ownerAgent.get(`/api/admin/roles/${role.body.role.id}`);
    expect(roleAfterFailures.body.role.attributes).toEqual([]);

    expect((await ownerAgent.put(`/api/admin/people/${person.body.person.id}/roles`).send({
      roles: [{ name: 'attribute-holder', resourceType: 'task', resourceId: 1 }]
    })).status).toBe(400);
  });

  test('manages permissions and alternative grants with replacement and validation', async () => {
    const firstAttribute = await ownerAgent.post('/api/admin/attributes').send({
      name: 'first_grant',
      resource: 'global'
    });
    const secondAttribute = await ownerAgent.post('/api/admin/attributes').send({
      name: 'second_grant',
      resource: 'project'
    });
    const permission = await ownerAgent.post('/api/admin/permissions').send({
      action: 'review',
      resource: 'project',
      description: 'Review a project'
    });
    expect(permission.status).toBe(201);
    expect((await ownerAgent.post('/api/admin/permissions').send({
      action: 'review',
      resource: 'project'
    })).status).toBe(409);
    expect((await ownerAgent.post('/api/admin/permissions').send({
      action: '',
      resource: 'project'
    })).status).toBe(400);

    const permissionList = await ownerAgent.get('/api/admin/permissions');
    expect(permissionList.status).toBe(200);
    expect(permissionList.body.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: permission.body.permission.id, alternatives: [] })
    ]));
    const grantPath = `/api/admin/permissions/${permission.body.permission.id}/grants`;
    const replacement = await ownerAgent.put(grantPath).send({
      alternatives: [[firstAttribute.body.attribute.id, secondAttribute.body.attribute.id], [firstAttribute.body.attribute.id]]
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body.grants).toEqual([
      [firstAttribute.body.attribute.id, secondAttribute.body.attribute.id],
      [firstAttribute.body.attribute.id]
    ]);

    const updatedList = await ownerAgent.get('/api/admin/permissions');
    expect(updatedList.body.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: permission.body.permission.id,
        alternatives: [
          [expect.objectContaining({ name: 'first_grant' }), expect.objectContaining({ name: 'second_grant' })],
          [expect.objectContaining({ name: 'first_grant' })]
        ]
      })
    ]));

    for (const alternatives of [
      'invalid',
      [1],
      [[0]],
      [[firstAttribute.body.attribute.id, firstAttribute.body.attribute.id]]
    ]) {
      const invalid = await ownerAgent.put(grantPath).send({ alternatives });
      expect(invalid.status).toBe(400);
    }
    const unknownAttribute = await ownerAgent.put(grantPath).send({ alternatives: [[99999]] });
    expect(unknownAttribute.status).toBe(400);
    expect(unknownAttribute.body.message).toMatch(/attributes do not exist/);

    const publicGrant = await ownerAgent.put(grantPath).send({ alternatives: [[]] });
    expect(publicGrant.status).toBe(200);
    const publicPermissions = await ownerAgent.get('/api/admin/permissions');
    expect(publicPermissions.body.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: permission.body.permission.id, alternatives: [[]] })
    ]));
    const denyAll = await ownerAgent.put(grantPath).send({ alternatives: [] });
    expect(denyAll.status).toBe(200);

    expect((await ownerAgent.put('/api/admin/permissions/99999/grants').send({
      alternatives: []
    })).status).toBe(404);
  });

  test('exercises project and nested task lifecycle, validation, and project scoping', async () => {
    const project = await ownerAgent.post('/api/projects').send({ name: 'Task Project' });
    const otherProject = await ownerAgent.post('/api/projects').send({ name: 'Other Project' });
    expect(project.status).toBe(201);
    expect(otherProject.status).toBe(201);
    const projectId = project.body.project.id;

    const projectList = await ownerAgent.get('/api/projects');
    expect(projectList.status).toBe(200);
    expect(projectList.body.projects.map(item => item.id)).toEqual(expect.arrayContaining([
      projectId,
      otherProject.body.project.id
    ]));
    const projectRead = await ownerAgent.get(`/api/projects/${projectId}`);
    expect(projectRead.status).toBe(200);
    const projectUpdate = await ownerAgent.patch(`/api/projects/${projectId}`)
      .send({ name: 'Renamed Project', description: 'Updated description', created_by: 999 });
    expect(projectUpdate.status).toBe(200);
    expect(projectUpdate.body.project).toMatchObject({
      name: 'Renamed Project',
      description: 'Updated description'
    });
    expect(projectUpdate.body.project.created_by).not.toBe(999);
    expect((await ownerAgent.post('/api/projects').send({ description: 'Missing name' })).status).toBe(400);

    const assignee = await createPerson(ownerAgent, { email: 'assignee@example.com' });
    const task = await ownerAgent.post(`/api/projects/${projectId}/tasks`).send({
      title: 'Root task',
      assignee_ids: [assignee.body.person.id],
      weight: 2
    });
    expect(task.status).toBe(201);
    expect(task.body.data).toMatchObject({
      title: 'Root task',
      project_id: projectId,
      assignees: [expect.objectContaining({ id: assignee.body.person.id })],
      subtasks: []
    });

    const listedTasks = await ownerAgent.get(`/api/projects/${projectId}/tasks`);
    expect(listedTasks.status).toBe(200);
    expect(listedTasks.body.data.map(item => item.id)).toEqual([task.body.data.id]);

    const child = await ownerAgent.post(`/api/projects/${projectId}/tasks`).send({
      title: 'Child task',
      parent_task_id: task.body.data.id,
      progress: 100,
      assignee_ids: []
    });
    expect(child.status).toBe(201);
    const updatedRoot = await ownerAgent.patch(
      `/api/projects/${projectId}/tasks/${task.body.data.id}`
    ).send({ title: 'Updated root', status: 'done', assignee_ids: [] });
    expect(updatedRoot.status).toBe(200);
    expect(updatedRoot.body.data).toMatchObject({
      title: 'Updated root',
      status: 'done',
      progress: 100,
      assignees: []
    });
    const refreshedList = await ownerAgent.get(`/api/projects/${projectId}/tasks`);
    expect(refreshedList.body.data[0].subtasks).toEqual([
      expect.objectContaining({ id: child.body.data.id, title: 'Child task' })
    ]);
    const persistedProject = await testDb('projects').where({ id: projectId }).first();
    expect(persistedProject.progress).toBe(100);

    const owner = await testDb('owner_account').first();
    const repositoryTask = await taskRepository.create({
      project_id: projectId,
      title: 'Repository-created task',
      status: 'todo',
      priority: 'medium',
      created_by: owner.user_id
    });
    expect(repositoryTask).toMatchObject({
      title: 'Repository-created task',
      assignees: [],
      subtasks: []
    });
    expect(await taskRepository.findById(99999)).toBeNull();
    const assignedRepositoryTask = await taskRepository.setAssignees(
      repositoryTask.id,
      [assignee.body.person.id]
    );
    expect(assignedRepositoryTask.assignees).toEqual([
      expect.objectContaining({ id: assignee.body.person.id })
    ]);
    const clearedRepositoryTask = await taskRepository.setAssignees(repositoryTask.id, []);
    expect(clearedRepositoryTask.assignees).toEqual([]);
    const updatedRepositoryTask = await taskRepository.update(repositoryTask.id, { priority: 'high' });
    expect(updatedRepositoryTask.priority).toBe('high');
    expect(await taskRepository.remove(repositoryTask.id)).toBe(1);
    expect(await taskRepository.remove(repositoryTask.id)).toBe(0);

    const invalidParent = await ownerAgent.post(`/api/projects/${projectId}/tasks`)
      .send({ title: 'Invalid child', parent_task_id: 99999 });
    expect(invalidParent.status).toBe(400);
    const invalidAssignees = await ownerAgent.post(`/api/projects/${projectId}/tasks`)
      .send({ title: 'Duplicate assignees', assignee_ids: [assignee.body.person.id, assignee.body.person.id] });
    expect(invalidAssignees.status).toBe(400);
    const wrongProjectUpdate = await ownerAgent.patch(
      `/api/projects/${otherProject.body.project.id}/tasks/${task.body.data.id}`
    ).send({ title: 'Must not update' });
    expect(wrongProjectUpdate.status).toBe(404);
    const badAssigneeUpdate = await ownerAgent.patch(
      `/api/projects/${projectId}/tasks/${task.body.data.id}`
    ).send({ assignee_ids: 'not-an-array' });
    expect(badAssigneeUpdate.status).toBe(400);

    const deleteChild = await ownerAgent.delete(
      `/api/projects/${projectId}/tasks/${child.body.data.id}`
    );
    expect(deleteChild.status).toBe(200);
    expect((await ownerAgent.delete(`/api/projects/${projectId}/tasks/99999`)).status).toBe(404);
    expect((await ownerAgent.delete('/api/projects/99999')).status).toBe(404);
    expect((await ownerAgent.patch('/api/projects/99999').send({ name: 'Missing' })).status).toBe(404);
    expect((await ownerAgent.get('/api/projects/99999')).status).toBe(404);
    const deletedProject = await ownerAgent.delete(`/api/projects/${otherProject.body.project.id}`);
    expect(deletedProject.status).toBe(200);
    expect(deletedProject.body.message).toBe('Project deleted successfully');
  });

  test('reports the authenticated profile and ends the session on logout', async () => {
    const health = await request(app).get('/api');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      message: 'Server is running',
      environment: 'test'
    });

    const profile = await ownerAgent.get('/api/auth/me');
    expect(profile.status).toBe(200);
    expect(profile.body.user).toMatchObject({
      email: 'owner@example.com',
      roles: ['owner'],
      roleAssignments: [{
        name: 'owner',
        resourceType: null,
        resourceId: null
      }],
      isOwner: true
    });

    const logout = await ownerAgent.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });
    expect((await ownerAgent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  test('rejects owner bootstrap when configuration, secret, or required fields are invalid', async () => {
    const originalSecret = process.env.OWNER_SETUP_SECRET;
    delete process.env.OWNER_SETUP_SECRET;
    const missingConfiguration = await request(app).post('/api/auth/bootstrap-owner').send({
      name: 'Another Owner',
      phone_number: '5550198',
      email: 'another@example.com',
      password: 'password',
      setup_secret: setupSecret
    });
    expect(missingConfiguration.status).toBe(503);

    process.env.OWNER_SETUP_SECRET = 'too-short';
    const weakConfiguration = await request(app).post('/api/auth/bootstrap-owner').send({
      setup_secret: 'too-short'
    });
    expect(weakConfiguration.status).toBe(503);

    process.env.OWNER_SETUP_SECRET = originalSecret;
    const missingFields = await request(app).post('/api/auth/bootstrap-owner')
      .send({ setup_secret: setupSecret });
    expect(missingFields.status).toBe(400);
    const wrongLength = await request(app).post('/api/auth/bootstrap-owner').send({
      setup_secret: 'different-length'
    });
    expect(wrongLength.status).toBe(403);
    expect((await testDb('owner_account').count({ count: '*' }).first()).count).toBe(1);
  });
});
