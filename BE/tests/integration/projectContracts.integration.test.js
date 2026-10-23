const fs = require('fs/promises');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const contractStorage = require('../../src/services/contractStorage.service');

const setupSecret = 'test-owner-setup-secret-1234567890';
const storageDirectory = process.env.CONTRACT_STORAGE_DIR;
const validPdf = Buffer.from('%PDF-1.7\nContract preview\n%%EOF');

let ownerAgent;

const team = [
  ['Name', 'Department', 'Role', 'Weekly Hours'],
  ['Ada', 'Art', 'Animator', 40],
  ['Bea', 'Art', 'Animator', 20],
  ['Cal', 'Art', 'Animator', 0]
];

const summary = [
  ['Name', 'Base Revenue Share %'],
  ['Ada', 0.5],
  ['Bea', 0.5]
];

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function makeProject(name = 'Contract Project') {
  const created = await ownerAgent.post('/api/projects').send({ name });
  expect(created.status).toBe(201);
  return created.body.project.id;
}

async function addSheets(projectId, sheets = [['Team', team], ['Summary', summary]]) {
  for (let position = 0; position < sheets.length; position += 1) {
    const [sheetName, data] = sheets[position];
    await testDb('project_sheets').insert({
      project_id: projectId,
      name: sheetName,
      position,
      data: JSON.stringify(data),
      source: 'upload',
      source_name: 'calculator.xlsx'
    });
  }
}

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await fs.rm(storageDirectory, { recursive: true, force: true });
  await fs.mkdir(storageDirectory, { recursive: true });
  await testDb('project_meeting_attendees').del();
  await testDb('project_meetings').del();
  await testDb('project_contracts').del();
  await testDb('project_contract_templates').del();
  await testDb('project_sheets').del();
  await testDb('owner_account').del();
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

  const bootstrap = await request(app).post('/api/auth/bootstrap-owner').send({
    name: 'Studio Owner',
    email: 'owner@example.com',
    phone_number: '5550199',
    password: 'password',
    setup_secret: setupSecret
  });
  expect(bootstrap.status).toBe(201);
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

describe('Project contract generation', () => {
  test('lists the people who are ready and the people waiting for hours', async () => {
    const projectId = await makeProject();
    await addSheets(projectId);

    const response = await ownerAgent.get(`/api/projects/${projectId}/contracts/people`);
    expect(response.status).toBe(200);
    expect(response.body.people.map((person) => person.name)).toEqual(['Ada', 'Bea']);
    expect(response.body.people[0]).toMatchObject({
      department: 'Art',
      role: 'Animator',
      hours: 40,
      share: '50.00%'
    });
    expect(response.body.waiting).toEqual([{ name: 'Cal', hours: 0 }]);
  });

  test('makes a contract for one person without touching anyone else', async () => {
    const projectId = await makeProject();
    await addSheets(projectId);

    const one = await ownerAgent
      .post(`/api/projects/${projectId}/contracts/generate`)
      .send({ person: 'Ada' });
    expect(one.status).toBe(201);
    expect(one.body).toMatchObject({ scope: 'person', person: 'Ada', people: 1 });
    expect(one.body.contracts).toHaveLength(1);
    expect(one.body.waiting).toEqual([]);

    const afterOne = await ownerAgent.get(`/api/projects/${projectId}/contracts`);
    expect(afterOne.status).toBe(200);
    expect(afterOne.body.contracts.map((contract) => contract.person_name)).toEqual(['Ada']);

    const everyone = await ownerAgent
      .post(`/api/projects/${projectId}/contracts/generate`)
      .send({});
    expect(everyone.status).toBe(201);
    expect(everyone.body).toMatchObject({ scope: 'sheet', people: 2 });
    expect(everyone.body.waiting).toEqual([{ name: 'Cal', hours: 0 }]);

    const afterAll = await ownerAgent.get(`/api/projects/${projectId}/contracts`);
    expect(afterAll.body.contracts.map((contract) => contract.person_name)).toEqual(['Ada', 'Bea']);

    // Running the single-person path again updates Ada, not the other person.
    const again = await ownerAgent
      .post(`/api/projects/${projectId}/contracts/generate`)
      .send({ person: 'Ada' });
    expect(again.status).toBe(201);
    expect(again.body.contracts).toHaveLength(1);
    const stillBoth = await ownerAgent.get(`/api/projects/${projectId}/contracts`);
    expect(stillBoth.body.contracts).toHaveLength(2);
  });

  test('explains an unknown person, a person with no hours, and a missing Team sheet', async () => {
    const projectId = await makeProject();
    await addSheets(projectId);

    const unknown = await ownerAgent
      .post(`/api/projects/${projectId}/contracts/generate`)
      .send({ person: 'Nobody' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toContain('No one named "Nobody"');

    const waiting = await ownerAgent
      .post(`/api/projects/${projectId}/contracts/generate`)
      .send({ person: 'Cal' });
    expect(waiting.status).toBe(400);
    expect(waiting.body.message).toContain('Cal has no weekly hours');

    const noTeam = await makeProject('No Team Project');
    await addSheets(noTeam, [['Summary', summary]]);
    const missing = await ownerAgent.get(`/api/projects/${noTeam}/contracts/people`);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('Team');
  });

  test('serves a generated PDF inline for preview and as an attachment for download', async () => {
    const projectId = await makeProject();
    await addSheets(projectId);
    const stored = await contractStorage.storeGeneratedFile(validPdf, 'pdf');
    const [contractId] = await testDb('project_contracts').insert({
      project_id: projectId,
      person_name: 'Amélie',
      document_data: JSON.stringify({ Name: 'Amélie' }),
      status: 'draft',
      pdf_key: stored.storageKey
    });

    const attachment = await ownerAgent
      .get(`/api/projects/${projectId}/contracts/${contractId}/file/pdf`)
      .buffer(true)
      .parse(binaryParser);
    expect(attachment.status).toBe(200);
    expect(attachment.headers['content-disposition']).toMatch(/^attachment;/);
    expect(attachment.body).toEqual(validPdf);

    const inline = await ownerAgent
      .get(`/api/projects/${projectId}/contracts/${contractId}/file/pdf?inline=1`)
      .buffer(true)
      .parse(binaryParser);
    expect(inline.status).toBe(200);
    expect(inline.headers['content-disposition']).toMatch(/^inline;/);
    expect(inline.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(inline.body).toEqual(validPdf);
  });
});
