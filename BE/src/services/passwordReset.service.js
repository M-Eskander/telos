const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const knex = require('../config/knex');
const mailerService = require('./mailer.service');

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const TOKEN_BYTES = 32;
const TOKEN_REGEX = /^[a-f0-9]{64}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

class PasswordResetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PasswordResetError';
    this.code = code;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildResetUrl(token, env = process.env) {
  const base = (env.APP_BASE_URL || 'https://team.telosstudio.games').replace(/\/+$/, '');
  return `${base}/reset-password?token=${token}`;
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordResetError(
      'WEAK_PASSWORD',
      `Choose a password with at least ${PASSWORD_MIN_LENGTH} characters`
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordResetError(
      'WEAK_PASSWORD',
      `Choose a password with at most ${PASSWORD_MAX_LENGTH} characters`
    );
  }
}

async function issueToken(userId, trx) {
  const query = trx || knex;
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await query('users').where({ id: userId }).update({
    password_reset_token_hash: hashToken(token),
    password_reset_expires_at: expiresAt
  });
  return { token, expiresAt };
}

async function clearToken(userId) {
  await knex('users').where({ id: userId }).update({
    password_reset_token_hash: null,
    password_reset_expires_at: null
  });
}

async function sendPasswordResetEmail(user) {
  if (!user || !user.id || !user.email) {
    return { sent: false, skipped: true, reason: 'missing recipient' };
  }
  const { token } = await issueToken(user.id);
  const resetUrl = buildResetUrl(token);
  const result = await mailerService.sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl
  });
  return { ...result, resetUrl };
}

// Always reports the same thing to callers; used by the public endpoint so it
// never reveals whether an email belongs to an account.
async function requestPasswordReset(email) {
  if (typeof email !== 'string' || !email.trim()) {
    return { requested: false };
  }
  const user = await knex('users').where({ email: email.trim() }).first();
  // Accounts without a password, or archived accounts, must not be claimable
  // through the reset flow.
  if (!user || !user.password || user.is_active === false || Number(user.is_active) === 0) {
    return { requested: false };
  }
  try {
    await sendPasswordResetEmail(user);
  } catch (error) {
    // A mail outage must not break the endpoint's generic behavior.
    console.error(`Failed to send password reset email to ${user.email}:`, error.message);
  }
  return { requested: true };
}

async function resetPassword(token, newPassword) {
  if (typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
    throw new PasswordResetError('INVALID_TOKEN', 'This reset link is invalid or has already been used');
  }
  validateNewPassword(newPassword);

  const user = await knex('users')
    .where({ password_reset_token_hash: hashToken(token) })
    .first();
  if (!user) {
    throw new PasswordResetError('INVALID_TOKEN', 'This reset link is invalid or has already been used');
  }

  const expiresAt = Number(user.password_reset_expires_at || 0);
  if (!expiresAt || expiresAt < Date.now()) {
    await clearToken(user.id);
    throw new PasswordResetError('TOKEN_EXPIRED', 'This reset link has expired; request a new one');
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await knex('users').where({ id: user.id }).update({
    password: hashed,
    password_reset_token_hash: null,
    password_reset_expires_at: null
  });
  return user;
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await knex('users').where({ id: userId }).first();
  if (!user) {
    throw new PasswordResetError('USER_NOT_FOUND', 'Account not found');
  }
  validateNewPassword(newPassword);

  const valid = typeof user.password === 'string' && user.password
    ? await bcrypt.compare(typeof currentPassword === 'string' ? currentPassword : '', user.password)
    : false;
  if (!valid) {
    throw new PasswordResetError('INVALID_CURRENT_PASSWORD', 'The current password is incorrect');
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await knex('users').where({ id: user.id }).update({
    password: hashed,
    password_reset_token_hash: null,
    password_reset_expires_at: null
  });
  return user;
}

module.exports = {
  TOKEN_TTL_MS,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PasswordResetError,
  hashToken,
  buildResetUrl,
  validateNewPassword,
  issueToken,
  sendPasswordResetEmail,
  requestPasswordReset,
  resetPassword,
  changePassword
};
