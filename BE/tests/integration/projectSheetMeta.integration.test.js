const request = require('supertest');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const sheetService = require('../../src/services/sheet.service');
const { buildStyledWorkbook } = require('../fixtures/styledWorkbook');
const { buildFormulaWorkbook } = require('../fixtures/formulaWorkbook');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await testDb('project_workbooks').del();
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

function workbookWithTabs(names) {
  const workbook = XLSX.utils.book_new();
  for (const name of names) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[name]]), name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('Project spreadsheet appearance', () => {
  test('import replaces the project tabs with every tab in the workbook', async () => {
    const projectId = await makeProject();
    const first = await ownerAgent
      .post(`/api/projects/${projectId}/sheets/import`)
      .attach('sheet', workbookWithTabs(['Alpha', 'Beta']), 'alpha-beta.xlsx');
    expect(first.status).toBe(201);
    expect(first.body.sheets.map((sheet) => sheet.name)).toEqual(['Alpha', 'Beta']);

    const second = await ownerAgent
      .post(`/api/projects/${projectId}/sheets/import`)
      .attach('sheet', workbookWithTabs(['Gamma', 'Delta']), 'gamma-delta.xlsx');
    expect(second.status).toBe(201);
    expect(second.body.sheets.map((sheet) => sheet.name)).toEqual(['Gamma', 'Delta']);

    const reread = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    expect(reread.status).toBe(200);
    expect(reread.body.sheets.map((sheet) => sheet.name)).toEqual(['Gamma', 'Delta']);
  });

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

  test('exports the original workbook with the edited cells and imports it back', async () => {
    const projectId = await makeProject();
    const imported = await ownerAgent
      .post(`/api/projects/${projectId}/sheets/import`)
      .attach('sheet', buildFormulaWorkbook(), 'formula.xlsx');
    expect(imported.status).toBe(201);
    const sheet = imported.body.sheets[0];
    expect(sheet.meta.imported).toEqual({ rows: 5, cols: 4 });

    const stored = await testDb('project_workbooks').where({ project_id: projectId }).first();
    expect(stored).toBeTruthy();
    expect(stored.file_name).toBe('formula.xlsx');
    expect(Buffer.from(stored.data).length).toBeGreaterThan(1000);

    const edited = sheet.data.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
    edited[1][0] = { ...edited[1][0], v: 15 };
    const saved = await ownerAgent
      .put(`/api/projects/${projectId}/sheets/${sheet.id}`)
      .send({ name: sheet.name, data: edited, meta: sheet.meta });
    expect(saved.status).toBe(200);
    expect(saved.body.sheets[0].data[1][1].v).toBe(30);

    const exported = await ownerAgent
      .get(`/api/projects/${projectId}/sheets/export`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    expect(exported.headers['content-disposition']).toContain('formula.xlsx');

    const parsed = sheetService.parseWorkbook(exported.body, 'formula.xlsx');
    expect(parsed.sheets[0].data[1][0].v).toBe(15);
    expect(parsed.sheets[0].data[1][1]).toMatchObject({ v: 30, f: 'A2*2' });
    expect(parsed.sheets[0].data[2][1]).toMatchObject({ v: 40, f: 'A3*2' });
    expect(parsed.sheets[0].data[0][0].s).toMatchObject({ b: 1, fill: '1f2937' });

    const reimported = await ownerAgent
      .post(`/api/projects/${projectId}/sheets/import`)
      .attach('sheet', exported.body, 'formula.xlsx');
    expect(reimported.status).toBe(201);
    expect(reimported.body.sheets[0].data[1][0].v).toBe(15);
    expect(reimported.body.sheets[0].data[1][1].v).toBe(30);

    const deleted = await ownerAgent.delete(`/api/projects/${projectId}`);
    expect(deleted.status).toBe(200);
    expect(await testDb('project_workbooks').where({ project_id: projectId })).toHaveLength(0);
  });
});
