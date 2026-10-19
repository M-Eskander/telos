const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');

const setupSecret = 'test-owner-setup-secret-1234567890';
const storageDirectory = process.env.CONTRACT_STORAGE_DIR;
const validPdf = Buffer.from('%PDF-1.7\nConfidential contract\n%%EOF');
let ownerAgent;

function attachContract(builder, pdf = validPdf, filename = 'contract.pdf', contentType = 'application/pdf') {
  return builder.attach('contract', pdf, { filename, contentType });
}

function personRequest(agent, overrides = {}) {
  const fields = {
    name: 'Contract Person',
    email: 'contract-person@example.com',
    phone_number: '5550100',
    password: 'password',
    contract_start_date: '2026-01-01',
    contract_end_date: '2027-01-01',
    ...overrides
  };
  let builder = agent.post('/api/admin/people');
  for (const [name, value] of Object.entries(fields)) {
    builder = builder.field(name, value === null ? '' : String(value));
  }
  return attachContract(builder);
}

function binaryParser(response, callback) {
  response.setEncoding('binary');
  let content = '';
  response.on('data', chunk => { content += chunk; });
  response.on('end', () => callback(null, Buffer.from(content, 'binary')));
}

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await fs.rm(storageDirectory, { recursive: true, force: true });
  await fs.mkdir(storageDirectory, { recursive: true });
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

describe('Required user contracts', () => {
  test('creates a person and contract atomically and provides a protected file download', async () => {
    const response = await personRequest(ownerAgent, {
      email: 'signed@example.com',
      contract_terms: 'Revenue-share terms remain separate.'
    });
    expect(response.status).toBe(201);
    const person = response.body.person;
    expect(person).toMatchObject({
      email: 'signed@example.com',
      is_active: 1,
      hasContract: true,
      contracts: [expect.objectContaining({
        start_date: '2026-01-01',
        end_date: '2027-01-01',
        terms: 'Revenue-share terms remain separate.',
        original_name: 'contract.pdf',
        mime_type: 'application/pdf',
        file_size: validPdf.length,
        uploaded: true
      })]
    });

    const contract = person.contracts[0];
    expect(contract.file_url).toBe(`/api/admin/contracts/${contract.id}/file`);
    expect(contract.storage_key).toBeUndefined();
    const record = await testDb('contracts').where({ id: contract.id }).first();
    expect(record).toMatchObject({
      user_id: person.id,
      file_url: contract.file_url,
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      terms: 'Revenue-share terms remain separate.',
      original_name: 'contract.pdf',
      mime_type: 'application/pdf',
      file_size: validPdf.length
    });
    expect(record.storage_key).toMatch(/^[0-9a-f-]{36}\.pdf$/i);
    expect(await fs.readFile(path.join(storageDirectory, record.storage_key))).toEqual(validPdf);

    const details = await ownerAgent.get(`/api/admin/people/${person.id}`);
    expect(details.body.person.contracts).toEqual([contract]);
    expect((await ownerAgent.get('/api/admin/people')).body.people)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        id: person.id,
        hasContract: true
      })]));

    const download = await ownerAgent.get(contract.file_url).buffer(true).parse(binaryParser);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toMatch(/application\/pdf/);
    expect(download.headers['content-disposition']).toContain('contract.pdf');
    expect(download.body).toEqual(validPdf);
    expect((await request(app).get(contract.file_url)).status).toBe(401);
  });

  test('rejects missing files, invalid PDFs, invalid dates, and oversized files without creating a person', async () => {
    const noFile = await ownerAgent.post('/api/admin/people')
      .field('name', 'No Contract')
      .field('email', 'no-contract@example.com')
      .field('phone_number', '5550101')
      .field('password', 'password')
      .field('contract_start_date', '2026-01-01')
      .field('contract_end_date', '2027-01-01');
    expect(noFile.status).toBe(400);

    const invalidPdf = await attachContract(
      ownerAgent.post('/api/admin/people')
        .field('name', 'Invalid PDF')
        .field('email', 'invalid-pdf@example.com')
        .field('phone_number', '5550103')
        .field('password', 'password')
        .field('contract_start_date', '2026-01-01')
        .field('contract_end_date', '2027-01-01'),
      Buffer.from('not a PDF')
    );
    expect(invalidPdf.status).toBe(400);
    const wrongMime = await attachContract(
      ownerAgent.post('/api/admin/people')
        .field('name', 'Wrong MIME')
        .field('email', 'wrong-mime@example.com')
        .field('phone_number', '5550105')
        .field('password', 'password')
        .field('contract_start_date', '2026-01-01')
        .field('contract_end_date', '2027-01-01'),
      validPdf,
      'contract.txt',
      'text/plain'
    );
    expect(wrongMime.status).toBe(400);

    const invalidDates = await personRequest(ownerAgent, {
      email: 'invalid-dates@example.com',
      contract_start_date: '2026-02-30'
    });
    expect(invalidDates.status).toBe(400);
    const reversedDates = await personRequest(ownerAgent, {
      email: 'reversed-dates@example.com',
      contract_start_date: '2027-01-01',
      contract_end_date: '2026-01-01'
    });
    expect(reversedDates.status).toBe(400);

    const oversized = await attachContract(
      ownerAgent.post('/api/admin/people')
        .field('name', 'Oversized PDF')
        .field('email', 'oversized@example.com')
        .field('phone_number', '5550104')
        .field('password', 'password')
        .field('contract_start_date', '2026-01-01')
        .field('contract_end_date', '2027-01-01'),
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024 + 1)]),
      'large.pdf'
    );
    expect(oversized.status).toBe(400);
    const duplicateEmail = await personRequest(ownerAgent, { email: 'owner@example.com' });
    expect(duplicateEmail.status).toBe(409);
    expect(await testDb('users').whereIn('email', [
      'no-contract@example.com',
      'invalid-pdf@example.com',
      'wrong-mime@example.com',
      'invalid-dates@example.com',
      'reversed-dates@example.com',
      'oversized@example.com'
    ])).toHaveLength(0);
    expect(await fs.readdir(storageDirectory)).toHaveLength(0);
  });

  test('requires a contract before activation and preserves archive/login behavior', async () => {
    const created = await personRequest(ownerAgent, { email: 'archive-me@example.com' });
    expect(created.status).toBe(201);
    const personId = created.body.person.id;
    const personAgent = request.agent(app);
    const login = await personAgent.post('/api/auth/login').send({
      email: 'archive-me@example.com',
      password: 'password'
    });
    expect(login.status).toBe(200);

    const archived = await ownerAgent.patch(`/api/admin/people/${personId}`)
      .send({ is_active: false });
    expect(archived.status).toBe(200);
    expect(Number(archived.body.person.is_active)).toBe(0);
    expect((await personAgent.get('/api/admin/people')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({
      email: 'archive-me@example.com',
      password: 'password'
    })).status).toBe(401);

    const reactivated = await ownerAgent.patch(`/api/admin/people/${personId}`)
      .send({ is_active: true });
    expect(reactivated.status).toBe(200);
    expect(Number(reactivated.body.person.is_active)).toBe(1);
    expect((await request(app).post('/api/auth/login').send({
      email: 'archive-me@example.com',
      password: 'password'
    })).status).toBe(200);
  });

  test('allows an archived legacy person to receive a contract before reactivation', async () => {
    const [userId] = await testDb('users').insert({
      name: 'Legacy Person',
      email: 'legacy@example.com',
      phone_number: '5550102',
      password: '$2a$10$testHashedPassword',
      is_active: false
    });
    const prematureActivation = await ownerAgent.patch(`/api/admin/people/${userId}`)
      .send({ is_active: true });
    expect(prematureActivation.status).toBe(400);
    expect(prematureActivation.body.message).toMatch(/uploaded contract/);

    const uploaded = await attachContract(
      ownerAgent.post(`/api/admin/people/${userId}/contracts`)
        .field('contract_start_date', '2026-02-01')
        .field('contract_end_date', '2027-02-01')
        .field('contract_terms', 'Legacy contract')
    );
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.contract).toMatchObject({
      user_id: userId,
      start_date: '2026-02-01',
      end_date: '2027-02-01',
      terms: 'Legacy contract',
      uploaded: true
    });
    expect((await ownerAgent.patch(`/api/admin/people/${userId}`)
      .send({ is_active: true })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({
      email: 'legacy@example.com',
      password: 'password'
    })).status).toBe(200);
  });

  test('requires owner authorization and retains multiple contract records as history', async () => {
    const created = await personRequest(ownerAgent, { email: 'history@example.com' });
    const personId = created.body.person.id;
    const personAgent = request.agent(app);
    await personAgent.post('/api/auth/login').send({
      email: 'history@example.com',
      password: 'password'
    });
    expect((await personAgent.post(`/api/admin/people/${personId}/contracts`)).status).toBe(403);

    const renewal = await attachContract(
      ownerAgent.post(`/api/admin/people/${personId}/contracts`)
        .field('contract_start_date', '2027-01-02')
        .field('contract_end_date', '2028-01-01')
    );
    expect(renewal.status).toBe(201);
    const details = await ownerAgent.get(`/api/admin/people/${personId}`);
    expect(details.body.person.contracts).toHaveLength(2);
    expect(details.body.person.contracts.map(contract => contract.start_date))
      .toEqual(['2027-01-02', '2026-01-01']);
  });
});
