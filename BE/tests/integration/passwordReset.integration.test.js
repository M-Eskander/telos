const request = require('supertest');
const bcrypt = require('bcryptjs');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');
const mailerService = require('../../src/services/mailer.service');
const authService = require('../../src/services/auth.service');

let mailerSpy;

function tokenFromResetUrl(resetUrl) {
  return new URL(resetUrl).searchParams.get('token');
}

async function createUser(overrides = {}) {
  const { verified, ...fields } = overrides;
  const user = await authService.createUser({
    name: 'Reset Person',
    email: 'reset-person@example.com',
    phone_number: '5550100',
    password: 'password',
    ...fields
  });
  if (verified) {
    await testDb('users').where({ id: user.id }).update({ email_verified_at: Date.now() });
  }
  return user;
}

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

  mailerSpy = jest.spyOn(mailerService, 'sendPasswordResetEmail')
    .mockResolvedValue({ sent: true, status: 200 });
});

afterEach(() => {
  mailerSpy.mockRestore();
});

afterAll(async () => {
  await knex.destroy();
});

describe('Password reset', () => {
  test('forgot-password stays generic for unknown, inactive, and missing emails', async () => {
    const unknown = await request(app).post('/api/auth/forgot-password').send({
      email: 'nobody@example.com'
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.ok).toBe(true);
    expect(mailerSpy).not.toHaveBeenCalled();

    await createUser({ email: 'inactive@example.com' });
    await testDb('users').where({ email: 'inactive@example.com' }).update({ is_active: 0 });
    const inactive = await request(app).post('/api/auth/forgot-password').send({
      email: 'inactive@example.com'
    });
    expect(inactive.status).toBe(200);
    expect(inactive.body.ok).toBe(true);
    expect(mailerSpy).not.toHaveBeenCalled();

    const missing = await request(app).post('/api/auth/forgot-password').send({});
    expect(missing.status).toBe(400);
  });

  test('emails a single-use reset link and signs future logins in with the new password', async () => {
    await createUser({ email: 'reset@example.com', verified: true });

    const forgot = await request(app).post('/api/auth/forgot-password').send({
      email: 'reset@example.com'
    });
    expect(forgot.status).toBe(200);
    expect(mailerSpy).toHaveBeenCalledTimes(1);
    expect(mailerSpy.mock.calls[0][0].to).toBe('reset@example.com');

    const row = await testDb('users').where({ email: 'reset@example.com' }).first();
    expect(row.password_reset_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(row.password_reset_expires_at)).toBeGreaterThan(Date.now());

    const token = tokenFromResetUrl(mailerSpy.mock.calls[0][0].resetUrl);
    const reset = await request(app).post('/api/auth/reset-password').send({
      token,
      new_password: 'brand-new-password'
    });
    expect(reset.status).toBe(200);
    expect(reset.body.ok).toBe(true);

    const after = await testDb('users').where({ email: 'reset@example.com' }).first();
    expect(after.password).toBe('$2a$10$testHashedPassword');
    expect(after.password_reset_token_hash).toBeNull();
    expect(after.password_reset_expires_at).toBeNull();

    const reuse = await request(app).post('/api/auth/reset-password').send({
      token,
      new_password: 'another-password'
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe('INVALID_TOKEN');

    const login = await request(app).post('/api/auth/login').send({
      email: 'reset@example.com',
      password: 'brand-new-password'
    });
    expect(login.status).toBe(200);
  });

  test('rejects malformed, expired, and weak-password reset attempts', async () => {
    const malformed = await request(app).post('/api/auth/reset-password').send({
      token: 'nope',
      new_password: 'long-enough-pass'
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_TOKEN');

    await createUser({ email: 'expired-reset@example.com' });
    await request(app).post('/api/auth/forgot-password').send({ email: 'expired-reset@example.com' });
    const expiredToken = tokenFromResetUrl(mailerSpy.mock.calls[0][0].resetUrl);
    await testDb('users').where({ email: 'expired-reset@example.com' })
      .update({ password_reset_expires_at: Date.now() - 60000 });

    const expired = await request(app).post('/api/auth/reset-password').send({
      token: expiredToken,
      new_password: 'long-enough-pass'
    });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('TOKEN_EXPIRED');

    await createUser({ email: 'weak-reset@example.com' });
    await request(app).post('/api/auth/forgot-password').send({ email: 'weak-reset@example.com' });
    const weakToken = tokenFromResetUrl(mailerSpy.mock.calls[1][0].resetUrl);

    const weak = await request(app).post('/api/auth/reset-password').send({
      token: weakToken,
      new_password: 'short'
    });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
  });

  test('change-password requires a session, the current password, and a strong new password', async () => {
    await createUser({ email: 'changer@example.com', verified: true });

    const anon = await request(app).post('/api/auth/change-password').send({
      current_password: 'password',
      new_password: 'long-enough-pass'
    });
    expect(anon.status).toBe(401);
    expect(anon.body.ok).toBe(false);

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({
      email: 'changer@example.com',
      password: 'password'
    });
    expect(login.status).toBe(200);

    const missingCurrent = await agent.post('/api/auth/change-password').send({
      new_password: 'long-enough-pass'
    });
    expect(missingCurrent.status).toBe(400);
    expect(missingCurrent.body.code).toBe('INVALID_CURRENT_PASSWORD');

    bcrypt.compare.mockResolvedValueOnce(false);
    const wrong = await agent.post('/api/auth/change-password').send({
      current_password: 'wrong-password',
      new_password: 'long-enough-pass'
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');

    const weak = await agent.post('/api/auth/change-password').send({
      current_password: 'password',
      new_password: 'short'
    });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');

    const changed = await agent.post('/api/auth/change-password').send({
      current_password: 'password',
      new_password: 'long-enough-pass'
    });
    expect(changed.status).toBe(200);
    expect(changed.body.ok).toBe(true);

    const row = await testDb('users').where({ email: 'changer@example.com' }).first();
    expect(row.password).toBe('$2a$10$testHashedPassword');
  });
});
