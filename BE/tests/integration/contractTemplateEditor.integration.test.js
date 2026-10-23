const fs = require('fs/promises');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const contractStorage = require('../../src/services/contractStorage.service');
const tokenService = require('../../src/services/onlyofficeToken.service');
const { buildContractDocx } = require('../fixtures/contractDocx');

const setupSecret = 'test-owner-setup-secret-1234567890';
const storageDirectory = process.env.CONTRACT_STORAGE_DIR;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let ownerAgent;

const binaryParser = (response, callback) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

function tokenFromUrl(url) {
  return new URL(url).pathname.split('/').pop();
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

async function makeProject(name = 'Contract Layout Project') {
  const created = await ownerAgent.post('/api/projects').send({ name });
  expect(created.status).toBe(201);
  return created.body.project.id;
}

async function uploadLayout(projectId, buffer = buildContractDocx()) {
  const response = await ownerAgent
    .put(`/api/projects/${projectId}/contract-template`)
    .field('name', 'Project Contract')
    .field('body', 'Project Contract for {{Name}}')
    .attach('layout', buffer, { filename: 'Project Contract.docx', contentType: DOCX_MIME });
  expect(response.status).toBe(200);
  return response.body.template;
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

describe('Contract layout editor', () => {
  test('issues a signed Word config and serves the uploaded .docx without a session', async () => {
    const projectId = await makeProject();
    const original = buildContractDocx();
    const template = await uploadLayout(projectId, original);

    const anonymous = await request(app).get(`/api/projects/${projectId}/contract-template/onlyoffice/config`);
    expect(anonymous.status).toBe(401);

    const configured = await ownerAgent.get(`/api/projects/${projectId}/contract-template/onlyoffice/config`);
    expect(configured.status).toBe(200);
    const config = configured.body.config;
    expect(config.documentType).toBe('word');
    expect(config.document).toMatchObject({ fileType: 'docx', title: 'Project Contract.docx' });
    expect(config.document.url).toMatch(/^http:\/\/backend:5000\/api\/onlyoffice\/contract-template\/document\//);
    expect(config.editorConfig.callbackUrl)
      .toMatch(/^http:\/\/backend:5000\/api\/onlyoffice\/contract-template\/callback\//);
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
    expect(document.headers['content-type']).toContain('wordprocessingml');
    expect(document.headers['content-disposition']).toMatch(/^inline;/);
    expect(document.body).toEqual(original);

    const callbackToken = tokenFromUrl(config.editorConfig.callbackUrl);
    const ack = await request(app)
      .post(`/api/onlyoffice/contract-template/callback/${callbackToken}`)
      .send({ token: tokenService.sign({ status: 4 }) });
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ error: 0 });
    expect(template.docx_key).toBeTruthy();
  });

  test('saves an edited .docx as the next project layout', async () => {
    const projectId = await makeProject();
    const original = buildContractDocx();
    const first = await uploadLayout(projectId, original);
    const configured = await ownerAgent.get(`/api/projects/${projectId}/contract-template/onlyoffice/config`);
    expect(configured.status).toBe(200);
    const config = configured.body.config;
    const callbackToken = tokenFromUrl(config.editorConfig.callbackUrl);
    const edited = buildContractDocx('Edited contract for {{Name}}');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(fileResponse(edited));

    try {
      const callback = await request(app)
        .post(`/api/onlyoffice/contract-template/callback/${callbackToken}`)
        .send({
          token: tokenService.sign({
            status: 2,
            url: 'http://onlyoffice/cache/files/output.docx?md5=1',
            key: config.document.key
          })
        });
      expect(callback.status).toBe(200);
      expect(callback.body).toEqual({ error: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('http://onlyoffice/cache/files/output.docx?md5=1');
    } finally {
      fetchMock.mockRestore();
    }

    const after = await ownerAgent.get(`/api/projects/${projectId}/contract-template`);
    expect(after.status).toBe(200);
    expect(after.body.template.docx_key).not.toBe(first.docx_key);
    expect(after.body.template.original_docx_name).toBe('Project Contract.docx');
    expect(await contractStorage.readContractFile(after.body.template.docx_key)).toEqual(edited);

    const next = await ownerAgent.get(`/api/projects/${projectId}/contract-template/onlyoffice/config`);
    expect(next.status).toBe(200);
    expect(next.body.config.document.key).not.toBe(config.document.key);
  });

  test('rejects a forged callback and a file from an unexpected host', async () => {
    const projectId = await makeProject();
    await uploadLayout(projectId);
    const configured = await ownerAgent.get(`/api/projects/${projectId}/contract-template/onlyoffice/config`);
    const config = configured.body.config;
    const callbackToken = tokenFromUrl(config.editorConfig.callbackUrl);

    const forged = await request(app)
      .post(`/api/onlyoffice/contract-template/callback/${callbackToken}`)
      .send({ token: 'not-a-jwt' });
    expect(forged.status).toBe(401);

    const fetchMock = jest.spyOn(global, 'fetch');
    try {
      const foreign = await request(app)
        .post(`/api/onlyoffice/contract-template/callback/${callbackToken}`)
        .send({ token: tokenService.sign({ status: 2, url: 'https://evil.example/cache/files/output.docx' }) });
      expect(foreign.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  test('does not open an editor when the project has no Word layout', async () => {
    const projectId = await makeProject();
    const response = await ownerAgent.get(`/api/projects/${projectId}/contract-template/onlyoffice/config`);
    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/Upload the Word layout/);
  });

  test('returns a clear configuration error when the ONLYOFFICE secret is absent', async () => {
    const projectId = await makeProject();
    await uploadLayout(projectId);
    const secret = process.env.ONLYOFFICE_JWT_SECRET;
    delete process.env.ONLYOFFICE_JWT_SECRET;
    try {
      const response = await ownerAgent.get(`/api/projects/${projectId}/contract-template/onlyoffice/config`);
      expect(response.status).toBe(503);
      expect(response.body.message).toMatch(/not configured/);
    } finally {
      process.env.ONLYOFFICE_JWT_SECRET = secret;
    }
  });
});
