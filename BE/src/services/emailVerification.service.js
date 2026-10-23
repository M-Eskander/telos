const crypto = require('crypto');
const knex = require('../config/knex');
const mailerService = require('./mailer.service');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_REGEX = /^[a-f0-9]{64}$/;

class VerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VerificationError';
    this.code = code;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildVerificationUrl(token, env = process.env) {
  const base = (env.APP_BASE_URL || 'https://team.telosstudio.games').replace(/\/+$/, '');
  return `${base}/verify-email.html?token=${token}`;
}

async function issueToken(userId, trx) {
  const query = trx || knex;
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await query('users').where({ id: userId }).update({
    email_verification_token_hash: hashToken(token),
    email_verification_expires_at: expiresAt
  });
  return { token, expiresAt };
}

async function sendVerificationEmail(user) {
  if (!user || !user.id || !user.email) {
    return { sent: false, skipped: true, reason: 'missing recipient' };
  }
  const { token } = await issueToken(user.id);
  const verifyUrl = buildVerificationUrl(token);
  const result = await mailerService.sendVerificationEmail({
    to: user.email,
    name: user.name,
    verifyUrl
  });
  if (result.sent) {
    // Once the mail is actually on its way, verification is no longer on
    // hold: from now on the person must confirm the address before signing in.
    await knex('users').where({ id: user.id }).update({
      email_verification_deferred_at: null
    });
  }
  return { ...result, verifyUrl };
}

async function verifyToken(token) {
  if (typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
    throw new VerificationError('INVALID_TOKEN', 'Invalid verification token');
  }

  const user = await knex('users')
    .where({ email_verification_token_hash: hashToken(token) })
    .first();
  if (!user) {
    throw new VerificationError('INVALID_TOKEN', 'This verification link is invalid or has already been used');
  }

  const expiresAt = Number(user.email_verification_expires_at || 0);
  if (!expiresAt || expiresAt < Date.now()) {
    await knex('users').where({ id: user.id }).update({
      email_verification_token_hash: null,
      email_verification_expires_at: null
    });
    throw new VerificationError('TOKEN_EXPIRED', 'This verification link has expired; request a new one');
  }

  await knex('users').where({ id: user.id }).update({
    email_verified_at: Date.now(),
    email_verification_deferred_at: null,
    email_verification_token_hash: null,
    email_verification_expires_at: null
  });
  return knex('users').where({ id: user.id }).first();
}

async function markVerified(userId) {
  const updated = await knex('users').where({ id: userId }).update({
    email_verified_at: Date.now(),
    email_verification_deferred_at: null,
    email_verification_token_hash: null,
    email_verification_expires_at: null
  });
  if (!updated) return null;
  return knex('users').where({ id: userId }).first();
}

// Always reports success to callers; used by the public resend endpoint so it
// never reveals whether an email belongs to an account.
async function requestVerificationForEmail(email) {
  if (typeof email !== 'string' || !email.trim()) {
    return { requested: false };
  }
  const user = await knex('users').where({ email: email.trim() }).first();
  if (!user || user.email_verified_at || user.email_verification_deferred_at) {
    // A person whose verification is on hold can already sign in. Only the
    // studio's explicit request should move them out of that state.
    return { requested: false };
  }
  await sendVerificationEmail(user);
  return { requested: true };
}

module.exports = {
  TOKEN_TTL_MS,
  VerificationError,
  hashToken,
  buildVerificationUrl,
  issueToken,
  sendVerificationEmail,
  verifyToken,
  markVerified,
  requestVerificationForEmail
};
