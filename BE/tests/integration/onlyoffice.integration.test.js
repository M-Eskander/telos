const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const sheetService = require('../../src/services/sheet.service');
const formulaService = require('../../src/services/formula.service');
const sheetExport = require('../../src/services/sheetExport.service');
const tokenService = require('../../src/services/onlyofficeToken.service');
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

async function makeProject(name = 'Full Editor Project') {
  const created = await ownerAgent.post('/api/projects').send({ name });
  expect(created.status).toBe(201);
  return created.body.project.id;
}

async function importFormula(projectId) {
  const imported = await ownerAgent
    .post(`/api/projects/${projectId}/sheets/import`)
    .attach('sheet', buildFormulaWorkbook(), 'formula.xlsx');
  expect(imported.status).toBe(201);
  return imported.body.sheets[0];
}

async function editorConfig(projectId) {
  const response = await ownerAgent.get(`/api/projects/${projectId}/onlyoffice/config`);
  expect(response.status).toBe(200);
  return response.body.config;
}

function tokenFromUrl(url) {
  return new URL(url).pathname.split('/').pop();
}

const binaryParser = (response, callback) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

function editedWorkbook() {
  const template = buildFormulaWorkbook();
  const sheets = sheetService.parseWorkbook(template, 'formula.xlsx').sheets;
  sheets[0].data[1][0] = { ...sheets[0].data[1][0], v: 15 };
  return sheetExport.exportWorkbook(template, formulaService.recalculate(sheets), 'formula.xlsx').buffer;
}

function fileResponse(buffer) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-length' ? String(buffer.length) : null)
    },
    body: null,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  };
}

describe('ONLYOFFICE full editor', () => {
  test('issues a signed config, serves the workbook to the Document Server and refuses anonymous callers', async () => {
    const projectId = await makeProject();
    await importFormula(projectId);

    const anonymous = await request(app).get(`/api/projects/${projectId}/onlyoffice/config`);
    expect(anonymous.status).toBe(401);
    const badLink = await request(app).get('/api/onlyoffice/document/not-a-token');
    expect(badLink.status).toBe(401);

    const config = await editorConfig(projectId);
    expect(config.documentType).toBe('cell');
    expect(config.document).toMatchObject({ fileType: 'xlsx', title: 'formula.xlsx' });
    expect(config.document.url).toMatch(new RegExp(`^http://backend:5000/api/onlyoffice/document/`));
    expect(config.editorConfig.callbackUrl).toMatch(new RegExp(`^http://backend:5000/api/onlyoffice/callback/`));
    expect(config.editorConfig.mode).toBe('edit');
    expect(config.editorConfig.customization).toMatchObject({ autosave: true, forcesave: true });

    const signed = tokenService.verify(config.token);
    expect(signed.document.key).toBe(config.document.key);
    expect(signed.editorConfig.callbackUrl).toBe(config.editorConfig.callbackUrl);

    const document = await request(app)
      .get(new URL(config.document.url).pathname)
      .buffer(true)
      .parse(binaryParser);
    expect(document.status).toBe(200);
    expect(document.headers['content-type']).toContain('spreadsheetml');
    expect(Buffer.isBuffer(document.body)).toBe(true);
    const parsed = sheetService.parseWorkbook(document.body, 'formula.xlsx').sheets[0];
    expect(parsed.data[1][0].v).toBe(10);
    expect(parsed.data[1][1].v).toBe(20);

    const callbackToken = tokenFromUrl(config.editorConfig.callbackUrl);
    const ack = await request(app)
      .post(`/api/onlyoffice/callback/${callbackToken}`)
      .send({ token: tokenService.sign({ status: 4 }) });
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ error: 0 });
  });

  test('saves the edited file, recalculates the sheets and keeps the file as the new template', async () => {
    const projectId = await makeProject();
    await importFormula(projectId);
    const config = await editorConfig(projectId);
    const callbackToken = tokenFromUrl(config.editorConfig.callbackUrl);
    const edited = editedWorkbook();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(fileResponse(edited));

    try {
      const callback = await request(app)
        .post(`/api/onlyoffice/callback/${callbackToken}`)
        .send({
          token: tokenService.sign({
            status: 2,
            url: 'http://onlyoffice/cache/files/output.xlsx?md5=1',
            key: config.document.key
          })
        });

      expect(callback.status).toBe(200);
      expect(callback.body).toEqual({ error: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('http://onlyoffice/cache/files/output.xlsx?md5=1');
    } finally {
      fetchMock.mockRestore();
    }

    const sheets = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    expect(sheets.status).toBe(200);
    expect(sheets.body.sheets[0].data[1][0].v).toBe(15);
    expect(sheets.body.sheets[0].data[1][1]).toMatchObject({ v: 30, f: 'A2*2' });

    const stored = await testDb('project_workbooks').where({ project_id: projectId }).first();
    expect(stored.file_name).toBe('formula.xlsx');
    expect(Buffer.compare(Buffer.from(stored.data), edited)).toBe(0);

    // The next editor session must not reuse the old cached document key.
    const nextConfig = await editorConfig(projectId);
    expect(nextConfig.document.key).not.toBe(config.document.key);
  });

  test('rejects a forged callback and a file from an unexpected host', async () => {
    const projectId = await makeProject();
    await importFormula(projectId);
    const config = await editorConfig(projectId);
    const callbackToken = tokenFromUrl(config.editorConfig.callbackUrl);

    const forged = await request(app)
      .post(`/api/onlyoffice/callback/${callbackToken}`)
      .send({ token: 'not-a-jwt' });
    expect(forged.status).toBe(401);

    const fetchMock = jest.spyOn(global, 'fetch');
    try {
      const foreign = await request(app)
        .post(`/api/onlyoffice/callback/${callbackToken}`)
        .send({ token: tokenService.sign({ status: 2, url: 'https://evil.example/cache/files/output.xlsx' }) });
      expect(foreign.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }

    const sheets = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    expect(sheets.body.sheets[0].data[1][0].v).toBe(10);
  });

  test('opens a plain workbook when a legacy project has no stored template', async () => {
    const projectId = await makeProject();
    await importFormula(projectId);
    await testDb('project_workbooks').where({ project_id: projectId }).del();

    const config = await editorConfig(projectId);
    const document = await request(app)
      .get(new URL(config.document.url).pathname)
      .buffer(true)
      .parse(binaryParser);
    expect(document.status).toBe(200);
    const parsed = sheetService.parseWorkbook(document.body, 'formula.xlsx');
    expect(parsed.sheets[0].data[1][0].v).toBe(10);
    expect(parsed.sheets[0].data[1][1].v).toBe(20);
  });

  test('returns a clear configuration error instead of a broken editor when the secret is absent', async () => {
    const projectId = await makeProject();
    await importFormula(projectId);
    const secret = process.env.ONLYOFFICE_JWT_SECRET;
    delete process.env.ONLYOFFICE_JWT_SECRET;
    try {
      const response = await ownerAgent.get(`/api/projects/${projectId}/onlyoffice/config`);
      expect(response.status).toBe(503);
      expect(response.body.message).toMatch(/not configured/);
    } finally {
      process.env.ONLYOFFICE_JWT_SECRET = secret;
    }
  });
});
