const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const mailerService = require('../../src/services/mailer.service');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;
let mailerSpy;

function tokenFromVerifyUrl(verifyUrl) {
  return new URL(verifyUrl).searchParams.get('token');
}

async function createPerson(overrides = {}) {
  const fields = {
    name: 'Verify Person',
    email: 'verify-person@example.com',
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
  return requestBuilder.attach(
    'contract',
    Buffer.from('%PDF-1.7\nTest contract\n%%EOF'),
    { filename: 'contract.pdf', contentType: 'application/pdf' }
  );
}

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await testDb('owner_account').del();
  await testDb('contracts').del();
  await testDb('user_attributes').del();
  await testDb('role_attributes').del();
  await testDb('user_roles').del();
  await testDb('task_assignment').del();
  await testDb('tasks').del();
  await testDb('projects').del();
  await testDb('users').del();

  mailerSpy = jest.spyOn(mailerService, 'sendVerificationEmail')
    .mockResolvedValue({ sent: true, status: 200 });

  const bootstrap = await request(app)
    .post('/api/auth/bootstrap-owner')
    .send({
      name: 'Studio Owner',
      email: 'owner@example.com',
      phone_number: '5550100',
      password: 'password',
      setup_secret: setupSecret
    });
  expect(bootstrap.status).toBe(201);
  expect(bootstrap.body.user.emailVerified).toBe(false);
  expect(bootstrap.body.verificationEmail.sent).toBe(true);

  const ownerToken = tokenFromVerifyUrl(mailerSpy.mock.calls[0][0].verifyUrl);
  expect((await request(app).post('/api/auth/verify-email').send({ token: ownerToken })).status)
    .toBe(200);
  mailerSpy.mockClear();

  ownerAgent = request.agent(app);
  const ownerLogin = await ownerAgent.post('/api/auth/login').send({
    email: 'owner@example.com',
    password: 'password'
  });
  expect(ownerLogin.status).toBe(200);
});

afterEach(() => {
  mailerSpy.mockRestore();
});

afterAll(async () => {
  delete process.env.OWNER_SETUP_SECRET;
  await knex.destroy();
});

describe('Email verification', () => {
  test('blocks login until the emailed token is consumed', async () => {
    const created = await createPerson({ email: 'verify-person@example.com' });
    expect(created.status).toBe(201);
    expect(created.body.person.emailVerified).toBe(false);
    expect(mailerSpy).toHaveBeenCalledTimes(1);
    expect(mailerSpy.mock.calls[0][0].to).toBe('verify-person@example.com');
    const verifyUrl = mailerSpy.mock.calls[0][0].verifyUrl;

    const row = await testDb('users').where({ email: 'verify-person@example.com' }).first();
    expect(row.email_verified_at).toBeFalsy();
    expect(row.email_verification_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(row.email_verification_expires_at)).toBeGreaterThan(Date.now());

    const blocked = await request(app).post('/api/auth/login').send({
      email: 'verify-person@example.com',
      password: 'password'
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

    const token = tokenFromVerifyUrl(verifyUrl);
    const verified = await request(app).post('/api/auth/verify-email').send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.user.emailVerified).toBe(true);

    const personAgent = request.agent(app);
    const login = await personAgent.post('/api/auth/login').send({
      email: 'verify-person@example.com',
      password: 'password'
    });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true);
    const me = await personAgent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.emailVerified).toBe(true);

    const reuse = await request(app).post('/api/auth/verify-email').send({ token });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe('INVALID_TOKEN');
  });

  test('rejects malformed, unknown, and expired tokens', async () => {
    const malformed = await request(app).post('/api/auth/verify-email').send({ token: 'nope' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_TOKEN');

    const unknown = await request(app).post('/api/auth/verify-email').send({ token: 'a'.repeat(64) });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('INVALID_TOKEN');

    await createPerson({ email: 'expired@example.com' });
    const token = tokenFromVerifyUrl(mailerSpy.mock.calls[0][0].verifyUrl);
    await testDb('users').where({ email: 'expired@example.com' })
      .update({ email_verification_expires_at: Date.now() - 60000 });

    const expired = await request(app).post('/api/auth/verify-email').send({ token });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('TOKEN_EXPIRED');

    const stillBlocked = await request(app).post('/api/auth/login').send({
      email: 'expired@example.com',
      password: 'password'
    });
    expect(stillBlocked.status).toBe(403);
    expect(stillBlocked.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('resend-verification responds generically and reissues tokens for unverified accounts', async () => {
    const unknown = await request(app).post('/api/auth/resend-verification').send({
      email: 'nobody@example.com'
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.ok).toBe(true);
    expect(mailerSpy).not.toHaveBeenCalled();

    await createPerson({ email: 'resend@example.com' });
    expect(mailerSpy).toHaveBeenCalledTimes(1);
    const resend = await request(app).post('/api/auth/resend-verification').send({
      email: 'resend@example.com'
    });
    expect(resend.status).toBe(200);
    expect(mailerSpy).toHaveBeenCalledTimes(2);

    const oldToken = tokenFromVerifyUrl(mailerSpy.mock.calls[0][0].verifyUrl);
    const newToken = tokenFromVerifyUrl(mailerSpy.mock.calls[1][0].verifyUrl);
    expect((await request(app).post('/api/auth/verify-email').send({ token: oldToken })).status)
      .toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: newToken })).status)
      .toBe(200);

    const again = await request(app).post('/api/auth/resend-verification').send({
      email: 'resend@example.com'
    });
    expect(again.status).toBe(200);
    expect(mailerSpy).toHaveBeenCalledTimes(2);
  });

  test('owner can resend and manually verify people', async () => {
    const created = await createPerson({ email: 'owner-override@example.com' });
    const personId = created.body.person.id;

    const sent = await ownerAgent.post(`/api/admin/people/${personId}/send-verification`);
    expect(sent.status).toBe(200);
    expect(mailerSpy).toHaveBeenCalledTimes(2);

    const listed = await ownerAgent.get('/api/admin/people');
    const listedPerson = listed.body.people.find(person => person.id === personId);
    expect(listedPerson.emailVerified).toBe(false);

    const verified = await ownerAgent.post(`/api/admin/people/${personId}/verify-email`);
    expect(verified.status).toBe(200);
    const details = await ownerAgent.get(`/api/admin/people/${personId}`);
    expect(details.body.person.emailVerified).toBe(true);

    const login = await request(app).post('/api/auth/login').send({
      email: 'owner-override@example.com',
      password: 'password'
    });
    expect(login.status).toBe(200);

    const resendAfter = await ownerAgent.post(`/api/admin/people/${personId}/send-verification`);
    expect(resendAfter.status).toBe(409);
  });

  test('reports unconfigured mail delivery when the owner resends', async () => {
    const created = await createPerson({ email: 'no-mail@example.com' });
    mailerSpy.mockResolvedValueOnce({ sent: false, skipped: true });

    const sent = await ownerAgent.post(`/api/admin/people/${created.body.person.id}/send-verification`);
    expect(sent.status).toBe(503);
  });

  test('changing the email resets verification', async () => {
    const created = await createPerson({ email: 'first@example.com' });
    const personId = created.body.person.id;
    const token = tokenFromVerifyUrl(mailerSpy.mock.calls[0][0].verifyUrl);
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(200);

    const changed = await ownerAgent.patch(`/api/admin/people/${personId}`)
      .send({ email: 'second@example.com' });
    expect(changed.status).toBe(200);
    expect(changed.body.person.emailVerified).toBe(false);

    const blocked = await request(app).post('/api/auth/login').send({
      email: 'second@example.com',
      password: 'password'
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});
