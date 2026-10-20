const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const mailerService = require('../../src/services/mailer.service');

const setupSecret = 'test-owner-setup-secret-1234567890';
let mailerSpy;

function tokenFromVerifyUrl(verifyUrl) {
  return new URL(verifyUrl).searchParams.get('token');
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
});

afterEach(() => {
  mailerSpy.mockRestore();
});

afterAll(async () => {
  delete process.env.OWNER_SETUP_SECRET;
  await knex.destroy();
});

describe('Owner email verification', () => {
  test('keeps the owner out until the emailed verification link is consumed', async () => {
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
    expect(bootstrap.body.user).toMatchObject({
      email: 'owner@example.com',
      isOwner: true,
      emailVerified: false
    });
    expect(bootstrap.body.verificationEmail).toEqual({ sent: true, skipped: false });
    expect(mailerSpy).toHaveBeenCalledTimes(1);
    expect(mailerSpy.mock.calls[0][0].to).toBe('owner@example.com');

    const blocked = await request(app).post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'password'
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      email: 'owner@example.com'
    });

    const token = tokenFromVerifyUrl(mailerSpy.mock.calls[0][0].verifyUrl);
    const verified = await request(app).post('/api/auth/verify-email').send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.user.emailVerified).toBe(true);

    const ownerAgent = request.agent(app);
    const login = await ownerAgent.post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'password'
    });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ isOwner: true, emailVerified: true });

    const people = await ownerAgent.get('/api/admin/people');
    expect(people.status).toBe(200);
  });

  test('reports when the verification email could not be sent', async () => {
    mailerSpy.mockResolvedValueOnce({ sent: false, skipped: true });

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
    expect(bootstrap.body.verificationEmail).toEqual({ sent: false, skipped: true });

    const blocked = await request(app).post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'password'
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});
