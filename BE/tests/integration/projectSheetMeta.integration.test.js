const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const { buildStyledWorkbook } = require('../fixtures/styledWorkbook');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
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

async function makeProject() {
  const created = await ownerAgent.post('/api/projects').send({ name: 'Styled Project' });
  expect(created.status).toBe(201);
  return created.body.project.id;
}

describe('Project spreadsheet appearance', () => {
  test('keeps imported widths, heights, styles, merges and freezes through a save', async () => {
    const projectId = await makeProject();
    const imported = await ownerAgent
      .post(`/api/projects/${projectId}/sheets/import`)
      .attach('sheet', buildStyledWorkbook(), 'styled.xlsx');

    expect(imported.status).toBe(201);
    expect(imported.body.warnings).toEqual([]);
    const sheet = imported.body.sheets[0];
    expect(sheet.meta).toMatchObject({
      cols: [120, 180, null, null],
      rows: { 0: 40 },
      merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
      freeze: { r: 1, c: 2 }
    });
    expect(sheet.data[0][0].s).toMatchObject({ b: 1, fill: '1f2937', va: 'middle', wrap: 1 });
    expect(sheet.data[1][0].s).toMatchObject({ i: 1, a: 'right', c: '666666' });

    const edited = sheet.data.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
    edited[1][0] = { ...edited[1][0], v: 99 };
    const saved = await ownerAgent
      .put(`/api/projects/${projectId}/sheets/${sheet.id}`)
      .send({ name: sheet.name, data: edited, meta: sheet.meta });
    expect(saved.status).toBe(200);
    expect(saved.body.sheet.data[1][0].v).toBe(99);
    expect(saved.body.sheet.data[1][0].s).toMatchObject({ i: 1, a: 'right' });
    expect(saved.body.sheet.meta).toEqual(sheet.meta);

    const reread = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    expect(reread.status).toBe(200);
    expect(reread.body.sheets[0].meta).toEqual(sheet.meta);
    expect(reread.body.sheets[0].data[0][0].s).toMatchObject({ b: 1, fill: '1f2937' });
  });
});
