const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');

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
  let requestBuilder = ownerAgent.post('/api/admin/people');
  for (const [field, value] of Object.entries(fields)) {
    requestBuilder = requestBuilder.field(
      field,
      value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    );
  }
  const response = await requestBuilder.attach(
    'contract',
    Buffer.from('%PDF-1.7\nTest contract\n%%EOF'),
    { filename: 'contract.pdf', contentType: 'application/pdf' }
  );
  // These tests exercise projects and timelines, not the verification gate; verify people up front.
  if (response.status === 201 && response.body && response.body.person) {
    await testDb('users').where({ id: response.body.person.id }).update({ email_verified_at: new Date() });
  }
  return response;
}

async function createProject(name) {
  const response = await ownerAgent.post('/api/projects').send({ name });
  expect(response.status).toBe(201);
  return response.body.project;
}

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await testDb('owner_account').del();
  await testDb('contracts').del();
  await testDb('project_contracts').del();
  await testDb('project_memberships').del();
  await testDb('project_departments').del();
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
  // These tests exercise projects and timelines, not the owner verification gate.
  await testDb('users').where({ id: bootstrap.body.user.id }).update({ email_verified_at: Date.now() });
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

describe('Project departments and people assignments', () => {
  test('creates project-specific departments and assigns, moves, lists, and removes members', async () => {
    const firstProject = await createProject('First Project');
    const secondProject = await createProject('Second Project');
    const art = await ownerAgent.post(`/api/projects/${firstProject.id}/departments`)
      .send({ name: 'Art' });
    const programming = await ownerAgent.post(`/api/projects/${firstProject.id}/departments`)
      .send({ name: 'Programming' });
    const secondProjectArt = await ownerAgent.post(`/api/projects/${secondProject.id}/departments`)
      .send({ name: 'Art' });
    const secondProjectAudio = await ownerAgent.post(`/api/projects/${secondProject.id}/departments`)
      .send({ name: 'Audio' });
    expect(art.status).toBe(201);
    expect(programming.status).toBe(201);
    expect(secondProjectArt.status).toBe(201);
    expect(secondProjectAudio.status).toBe(201);
    expect(art.body.department.projectId).toBe(firstProject.id);
    expect(secondProjectArt.body.department.projectId).toBe(secondProject.id);

    const duplicate = await ownerAgent.post(`/api/projects/${firstProject.id}/departments`)
      .send({ name: 'Art' });
    expect(duplicate.status).toBe(409);
    expect((await ownerAgent.post(`/api/projects/${firstProject.id}/departments`).send({ name: '  ' })).status)
      .toBe(400);

    const person = await createPerson({ email: 'artist@example.com', name: 'Artist' });
    expect(person.status).toBe(201);
    const personId = person.body.person.id;
    const assigned = await ownerAgent.put(`/api/projects/${firstProject.id}/members/${personId}`)
      .send({ departmentId: art.body.department.id });
    const assignedToSecondProject = await ownerAgent.put(
      `/api/projects/${secondProject.id}/members/${personId}`
    ).send({ departmentId: secondProjectAudio.body.department.id });
    expect(assigned.status).toBe(200);
    expect(assignedToSecondProject.status).toBe(200);
    expect(assignedToSecondProject.body.member.departmentName).toBe('Audio');
    expect(assigned.body.member).toMatchObject({
      userId: personId,
      name: 'Artist',
      projectId: firstProject.id,
      departmentId: art.body.department.id,
      departmentName: 'Art'
    });

    const members = await ownerAgent.get(`/api/projects/${firstProject.id}/members`);
    expect(members.status).toBe(200);
    expect(members.body.members).toEqual([
      expect.objectContaining({ userId: personId, departmentName: 'Art' })
    ]);
    const departments = await ownerAgent.get(`/api/projects/${firstProject.id}/departments`);
    expect(departments.status).toBe(200);
    expect(departments.body.departments.map(department => department.name))
      .toEqual(['Art', 'Programming']);
    expect((await ownerAgent.get(`/api/projects/${secondProject.id}/members`)).body.members)
      .toEqual([expect.objectContaining({ userId: personId, departmentName: 'Audio' })]);

    const moved = await ownerAgent.put(`/api/projects/${firstProject.id}/members/${personId}`)
      .send({ departmentId: programming.body.department.id });
    expect(moved.status).toBe(200);
    expect(moved.body.member.departmentName).toBe('Programming');
    expect((await ownerAgent.get(`/api/projects/${secondProject.id}/members`))
      .body.members[0].departmentName).toBe('Audio');
    expect(await testDb('project_memberships').where({
      project_id: firstProject.id,
      user_id: personId
    }).count({ count: '*' }).first()).toMatchObject({ count: 1 });

    const unassignedDepartment = await ownerAgent.put(
      `/api/projects/${firstProject.id}/members/${personId}`
    ).send({ departmentId: null });
    expect(unassignedDepartment.status).toBe(200);
    expect(unassignedDepartment.body.member.departmentId).toBeNull();
    expect(unassignedDepartment.body.member.departmentName).toBeNull();

    await ownerAgent.put(`/api/projects/${firstProject.id}/members/${personId}`)
      .send({ departmentId: programming.body.department.id });
    const removedDepartment = await ownerAgent.delete(
      `/api/projects/${firstProject.id}/departments/${programming.body.department.id}`
    );
    expect(removedDepartment.status).toBe(200);
    const memberAfterDepartmentRemoval = await ownerAgent.get(`/api/projects/${firstProject.id}/members`);
    expect(memberAfterDepartmentRemoval.body.members).toEqual([
      expect.objectContaining({ userId: personId, departmentId: null, departmentName: null })
    ]);
    expect((await ownerAgent.delete(
      `/api/projects/${firstProject.id}/departments/${programming.body.department.id}`
    )).status).toBe(404);

    const crossProjectDepartment = await ownerAgent.put(
      `/api/projects/${firstProject.id}/members/${personId}`
    ).send({ departmentId: secondProjectArt.body.department.id });
    expect(crossProjectDepartment.status).toBe(400);
    expect((await ownerAgent.put(`/api/projects/${firstProject.id}/members/${personId}`)
      .send({ departmentId: 'not-an-id' })).status).toBe(400);
    expect((await ownerAgent.put(`/api/projects/${firstProject.id}/members/not-an-id`)
      .send({ departmentId: null })).status).toBe(400);

    const firstProjectTask = await ownerAgent.post(`/api/projects/${firstProject.id}/tasks`).send({
      title: 'First project assigned task',
      assignee_ids: [personId]
    });
    const secondProjectTask = await ownerAgent.post(`/api/projects/${secondProject.id}/tasks`).send({
      title: 'Second project assigned task',
      assignee_ids: [personId]
    });
    expect(firstProjectTask.status).toBe(201);
    expect(secondProjectTask.status).toBe(201);

    const inactive = await createPerson({
      email: 'archived@example.com',
      is_active: false
    });
    expect(inactive.status).toBe(201);
    const archivedAssignment = await ownerAgent.put(
      `/api/projects/${firstProject.id}/members/${inactive.body.person.id}`
    ).send({ departmentId: art.body.department.id });
    expect(archivedAssignment.status).toBe(400);
    expect(archivedAssignment.body.message).toMatch(/active person/);
    expect((await ownerAgent.put(`/api/projects/${firstProject.id}/members/99999`)
      .send({ departmentId: null })).status).toBe(400);

    const archivedAfterAssignment = await createPerson({
      email: 'archive-after-assignment@example.com'
    });
    await ownerAgent.put(`/api/projects/${firstProject.id}/members/${archivedAfterAssignment.body.person.id}`)
      .send({ departmentId: art.body.department.id });
    const archivedProfile = await ownerAgent.patch(
      `/api/admin/people/${archivedAfterAssignment.body.person.id}`
    ).send({ is_active: false });
    expect(archivedProfile.status).toBe(200);
    const activeMembersAfterArchive = await ownerAgent.get(`/api/projects/${firstProject.id}/members`);
    expect(activeMembersAfterArchive.body.members.map(member => member.userId))
      .not.toContain(archivedAfterAssignment.body.person.id);

    expect((await ownerAgent.get('/api/projects/99999/departments')).status).toBe(404);
    expect((await ownerAgent.post('/api/projects/99999/departments').send({ name: 'Design' })).status)
      .toBe(404);
    expect((await ownerAgent.get('/api/projects/99999/members')).status).toBe(404);
    expect((await ownerAgent.put('/api/projects/99999/members/1').send({ departmentId: null })).status)
      .toBe(404);
    expect((await ownerAgent.get('/api/projects/99999/timeline')).status).toBe(404);
    expect((await ownerAgent.delete(`/api/projects/${firstProject.id}/members/${personId}`)).status)
      .toBe(200);
    expect(await testDb('task_assignment').where({
      task_id: firstProjectTask.body.data.id,
      user_id: personId
    }).first()).toBeUndefined();
    expect(await testDb('task_assignment').where({
      task_id: secondProjectTask.body.data.id,
      user_id: personId
    }).first()).toBeDefined();
    expect((await ownerAgent.get(`/api/projects/${secondProject.id}/members`))
      .body.members).toEqual([expect.objectContaining({ userId: personId, departmentName: 'Audio' })]);
    expect((await ownerAgent.delete(`/api/projects/${firstProject.id}/members/${personId}`)).status)
      .toBe(404);
    expect((await ownerAgent.delete('/api/projects/99999/departments/1')).status).toBe(404);
  });

  test('requires authentication and project update permissions for team administration', async () => {
    const project = await createProject('Private Project');
    expect((await request(app).get(`/api/projects/${project.id}/departments`)).status).toBe(401);
    expect((await request(app).post(`/api/projects/${project.id}/departments`)
      .send({ name: 'Art' })).status).toBe(401);

    const person = await createPerson({ email: 'restricted@example.com' });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({
      email: person.body.person.email,
      password: 'password'
    });
    expect(login.status).toBe(200);
    expect((await agent.get(`/api/projects/${project.id}/departments`)).status).toBe(403);
    expect((await agent.put(`/api/projects/${project.id}/members/${person.body.person.id}`)
      .send({ departmentId: null })).status).toBe(403);
  });
});

describe('Project member contracts', () => {
  test('adds a member only with a project contract PDF and lists the PDF on the contract', async () => {
    const project = await createProject('Contract Team');
    const department = await ownerAgent.post(`/api/projects/${project.id}/departments`)
      .send({ name: 'Art' });
    const person = await createPerson({
      email: 'contract-member@example.com',
      name: 'Contract Member'
    });
    const personId = person.body.person.id;

    const missing = await ownerAgent.post(`/api/projects/${project.id}/members`)
      .field('userId', personId);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/project contract PDF/i);
    expect(await testDb('project_memberships').where({
      project_id: project.id,
      user_id: personId
    }).first()).toBeUndefined();

    const invalid = await ownerAgent.post(`/api/projects/${project.id}/members`)
      .field('userId', personId)
      .field('departmentId', department.body.department.id)
      .attach('contract', Buffer.from('not a PDF'), {
        filename: 'contract.pdf',
        contentType: 'application/pdf'
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toMatch(/valid PDF/i);

    const added = await ownerAgent.post(`/api/projects/${project.id}/members`)
      .field('userId', personId)
      .field('departmentId', department.body.department.id)
      .attach('contract', Buffer.from('%PDF-1.7\nProject contract\n%%EOF'), {
        filename: 'contract.pdf',
        contentType: 'application/pdf'
      });
    expect(added.status).toBe(201);
    expect(added.body.member).toMatchObject({
      userId: personId,
      departmentName: 'Art',
      hasProjectContract: true
    });

    const stored = await testDb('project_contracts')
      .where({ project_id: project.id, user_id: personId })
      .first();
    expect(stored).toBeDefined();
    expect(stored.source).toBe('uploaded');
    expect(stored.status).toBe('uploaded');
    expect(stored.pdf_key).toBeTruthy();
    expect(stored.docx_key).toBeFalsy();
    const storedData = typeof stored.document_data === 'string'
      ? JSON.parse(stored.document_data)
      : stored.document_data;
    expect(storedData).toMatchObject({
      Name: 'Contract Member',
      Department: 'Art',
      Project: 'Contract Team'
    });

    const contracts = await ownerAgent.get(`/api/projects/${project.id}/contracts`);
    expect(contracts.status).toBe(200);
    const listed = contracts.body.contracts.find(contract => contract.id === stored.id);
    expect(listed).toMatchObject({
      person_name: 'Contract Member',
      user_id: personId,
      source: 'uploaded',
      has_pdf: true,
      has_word: false
    });
    expect(listed.data.Name).toBe('Contract Member');

    const members = await ownerAgent.get(`/api/projects/${project.id}/members`);
    expect(members.body.members).toEqual([
      expect.objectContaining({
        userId: personId,
        contractId: stored.id,
        hasProjectContract: true
      })
    ]);

    const duplicate = await ownerAgent.post(`/api/projects/${project.id}/members`)
      .field('userId', personId)
      .attach('contract', Buffer.from('%PDF-1.7\nAnother contract\n%%EOF'), {
        filename: 'contract.pdf',
        contentType: 'application/pdf'
      });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toMatch(/already a member/i);
    expect(await testDb('project_contracts').where({
      project_id: project.id,
      user_id: personId
    })).toHaveLength(1);
  });

  test('attaches or replaces a contract for a member who is already on the team', async () => {
    const project = await createProject('Existing Team Contract');
    const person = await createPerson({
      email: 'existing-team@example.com',
      name: 'Existing Team Member'
    });
    const personId = person.body.person.id;
    await ownerAgent.put(`/api/projects/${project.id}/members/${personId}`)
      .send({ departmentId: null });

    let members = await ownerAgent.get(`/api/projects/${project.id}/members`);
    expect(members.body.members[0]).toMatchObject({
      userId: personId,
      hasProjectContract: false
    });

    const missing = await ownerAgent.post(`/api/projects/${project.id}/members/${personId}/contract`);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/project contract PDF/i);

    const attached = await ownerAgent.post(`/api/projects/${project.id}/members/${personId}/contract`)
      .attach('contract', Buffer.from('%PDF-1.7\nFirst project contract\n%%EOF'), {
        filename: 'first.pdf',
        contentType: 'application/pdf'
      });
    expect(attached.status).toBe(200);
    expect(attached.body.contract.id).toBeTruthy();

    members = await ownerAgent.get(`/api/projects/${project.id}/members`);
    expect(members.body.members[0]).toMatchObject({
      userId: personId,
      hasProjectContract: true
    });

    const replaced = await ownerAgent.post(`/api/projects/${project.id}/members/${personId}/contract`)
      .attach('contract', Buffer.from('%PDF-1.7\nReplacement contract\n%%EOF'), {
        filename: 'replacement.pdf',
        contentType: 'application/pdf'
      });
    expect(replaced.status).toBe(200);
    expect(replaced.body.contract.id).toBe(attached.body.contract.id);

    const rows = await testDb('project_contracts').where({
      project_id: project.id,
      user_id: personId
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('uploaded');
    const contracts = await ownerAgent.get(`/api/projects/${project.id}/contracts`);
    expect(contracts.body.contracts.filter(contract => contract.user_id === personId)).toHaveLength(1);
  });
});

describe('Dated project timeline endpoint', () => {
  test('returns dated root tasks and subtasks in date order with active project assignees', async () => {
    const project = await createProject('Timeline Project');
    const otherProject = await createProject('Other Timeline Project');
    const department = await ownerAgent.post(`/api/projects/${project.id}/departments`)
      .send({ name: 'Design' });
    const activePerson = await createPerson({ email: 'timeline-active@example.com' });
    const archivedPerson = await createPerson({
      email: 'timeline-archived@example.com',
      is_active: false
    });
    await ownerAgent.put(`/api/projects/${project.id}/members/${activePerson.body.person.id}`)
      .send({ departmentId: department.body.department.id });
    const owner = await testDb('owner_account').first();
    await ownerAgent.put(`/api/projects/${project.id}/members/${owner.user_id}`)
      .send({ departmentId: null });

    const root = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({
      title: 'Root dated task',
      start_date: '2026-06-01',
      end_date: '2026-06-10',
      assignee_ids: [activePerson.body.person.id, owner.user_id]
    });
    expect(root.status).toBe(201);
    const child = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({
      title: 'Dated subtask',
      parent_task_id: root.body.data.id,
      start_date: '2026-06-03',
      end_date: '2026-06-05',
      assignee_ids: [activePerson.body.person.id]
    });
    expect(child.status).toBe(201);
    const startOnly = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({
      title: 'Start-only task',
      start_date: '2026-06-02'
    });
    expect(startOnly.status).toBe(201);
    const endOnly = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({
      title: 'End-only task',
      end_date: '2026-06-04'
    });
    expect(endOnly.status).toBe(201);
    const undated = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({
      title: 'Undated task'
    });
    expect(undated.status).toBe(201);
    const otherProjectTask = await ownerAgent.post(`/api/projects/${otherProject.id}/tasks`).send({
      title: 'Other project dated task',
      start_date: '2026-06-01'
    });
    expect(otherProjectTask.status).toBe(201);

    await testDb('task_assignment').insert({
      task_id: root.body.data.id,
      user_id: archivedPerson.body.person.id
    });

    const timeline = await ownerAgent.get(`/api/projects/${project.id}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.ok).toBe(true);
    expect(timeline.body.tasks.map(task => task.id)).toEqual([
      root.body.data.id,
      startOnly.body.data.id,
      child.body.data.id,
      endOnly.body.data.id
    ]);
    expect(timeline.body.tasks).toEqual([
      expect.objectContaining({
        id: root.body.data.id,
        parent_task_id: null,
        start_date: '2026-06-01',
        end_date: '2026-06-10',
        assignees: expect.arrayContaining([
          expect.objectContaining({ id: activePerson.body.person.id }),
          expect.objectContaining({ id: owner.user_id })
        ])
      }),
      expect.objectContaining({
        id: startOnly.body.data.id,
        start_date: '2026-06-02',
        end_date: null
      }),
      expect.objectContaining({
        id: child.body.data.id,
        parent_task_id: root.body.data.id,
        start_date: '2026-06-03',
        end_date: '2026-06-05',
        assignees: [expect.objectContaining({ id: activePerson.body.person.id })]
      }),
      expect.objectContaining({
        id: endOnly.body.data.id,
        start_date: null,
        end_date: '2026-06-04'
      })
    ]);
    expect(timeline.body.tasks.flatMap(task => task.assignees).map(person => person.id))
      .not.toContain(archivedPerson.body.person.id);
    expect(timeline.body.tasks.map(task => task.id))
      .not.toContain(undated.body.data.id);
    expect(timeline.body.tasks.map(task => task.id))
      .not.toContain(otherProjectTask.body.data.id);
  });

  test('returns an empty timeline for a project with no dated tasks and denies unauthorised users', async () => {
    const project = await createProject('Empty Timeline');
    const undated = await ownerAgent.post(`/api/projects/${project.id}/tasks`)
      .send({ title: 'No schedule yet' });
    expect(undated.status).toBe(201);
    const timeline = await ownerAgent.get(`/api/projects/${project.id}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.tasks).toEqual([]);
    expect((await request(app).get(`/api/projects/${project.id}/timeline`)).status).toBe(401);

    const person = await createPerson({ email: 'timeline-denied@example.com' });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({
      email: person.body.person.email,
      password: 'password'
    });
    expect((await agent.get(`/api/projects/${project.id}/timeline`)).status).toBe(403);
  });

  test('rejects task assignments to people who are not project members', async () => {
    const project = await createProject('Assignment Guard');
    const person = await createPerson({ email: 'not-a-member@example.com' });

    const response = await ownerAgent.post(`/api/projects/${project.id}/tasks`).send({
      title: 'Invalid assignment',
      start_date: '2026-06-01',
      assignee_ids: [person.body.person.id]
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/assigned to this project/);
    expect(await testDb('tasks').where({
      project_id: project.id,
      title: 'Invalid assignment'
    }).first()).toBeUndefined();
  });
});
