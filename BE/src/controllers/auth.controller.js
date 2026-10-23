const passport = require('../middleware/auth.middleware');
const authService = require('../services/auth.service');
const emailVerificationService = require('../services/emailVerification.service');
const passwordResetService = require('../services/passwordReset.service');
const sessionService = require('../services/session.service');
const pdpService = require('../services/pdp.service');
const crypto = require('crypto');

// The primary request fields are snake_case (matching the rest of the API),
// with camelCase accepted for convenience.
function readNewPassword(body) {
  const payload = body || {};
  return payload.new_password !== undefined ? payload.new_password : payload.newPassword;
}

function serializeRoleAssignments(roles) {
  return (roles || []).map(role => typeof role === 'string'
    ? { name: role, resourceType: null, resourceId: null, accessPreset: null }
    : {
      name: role.name,
      resourceType: role.resourceType || null,
      resourceId: role.resourceId || null,
      accessPreset: role.accessPreset || null
    });
}

function serializeVerification(user) {
  const verified = !!user.email_verified_at;
  const deferred = !verified && !!user.email_verification_deferred_at;
  return {
    emailVerified: verified,
    emailVerificationDeferred: deferred,
    emailVerificationStatus: verified ? 'verified' : deferred ? 'deferred' : 'pending'
  };
}

// UI hint only: the server still enforces every permission. Returning the
// resolved list lets the frontend hide actions the person cannot use.
async function globalPermissionsFor(user) {
  if (user.isOwner === true) return ['*'];
  try {
    return await pdpService.getEffectivePermissions(user.id, user.roles || [], null);
  } catch (error) {
    console.error(`Could not resolve global permissions for user ${user.id}:`, error.message);
    return [];
  }
}

exports.login = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      if (info && info.code === 'EMAIL_NOT_VERIFIED') {
        return res.status(403).json({
          ok: false,
          code: 'EMAIL_NOT_VERIFIED',
          message: info.message,
          email: info.email
        });
      }
      return res.status(401).json({ ok: false, message: info && info.message });
    }
    req.logIn(user, async (err) => {
      if (err) return next(err);
      return res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          ...serializeVerification(user),
          roles: serializeRoleAssignments(user.roles).map(role => role.name),
          roleAssignments: serializeRoleAssignments(user.roles),
          isOwner: user.isOwner,
          permissions: await globalPermissionsFor(user)
        }
      });
    });
  })(req, res, next);
};

exports.logout = (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    if (!req.session) return res.json({ ok: true });
    req.session.destroy(sessionError => {
      if (sessionError) return next(sessionError);
      return res.json({ ok: true });
    });
  });
};

exports.me = async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ ok: false });
  res.json({
    ok: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      ...serializeVerification(req.user),
      roles: serializeRoleAssignments(req.user.roles).map(role => role.name),
      roleAssignments: serializeRoleAssignments(req.user.roles),
      isOwner: req.user.isOwner,
      permissions: await globalPermissionsFor(req.user)
    }
  });
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const user = await emailVerificationService.verifyToken(token);
    return res.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        emailVerificationDeferred: false,
        emailVerificationStatus: 'verified'
      }
    });
  } catch (error) {
    if (error instanceof emailVerificationService.VerificationError) {
      const status = error.code === 'TOKEN_EXPIRED' ? 410 : 400;
      return res.status(status).json({ ok: false, code: error.code, message: error.message });
    }
    return next(error);
  }
};

exports.resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ ok: false, message: 'Email is required' });
    }
    // Always the same response, whether or not the account exists or is unverified.
    await emailVerificationService.requestVerificationForEmail(email);
    return res.json({
      ok: true,
      message: 'If that email belongs to an unverified account, a new verification email has been sent'
    });
  } catch (error) {
    return next(error);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ ok: false, message: 'Email is required' });
    }
    // Always the same response, whether or not the account exists.
    await passwordResetService.requestPasswordReset(email);
    return res.json({
      ok: true,
      message: 'If an account exists for that email, a password reset link has been sent'
    });
  } catch (error) {
    return next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const newPassword = readNewPassword(req.body);
    const user = await passwordResetService.resetPassword(token, newPassword);

    // Any session opened with the old password is no longer trustworthy.
    const sessionsInvalidated = await sessionService.invalidateUserSessions(user.id);
    return res.json({
      ok: true,
      sessionsInvalidated,
      message: 'Your password has been updated. Sign in with your new password.'
    });
  } catch (error) {
    if (error instanceof passwordResetService.PasswordResetError) {
      const status = error.code === 'TOKEN_EXPIRED' ? 410 : 400;
      return res.status(status).json({ ok: false, code: error.code, message: error.message });
    }
    return next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const body = req.body || {};
    const suppliedCurrent = body.current_password !== undefined
      ? body.current_password
      : body.currentPassword;
    const newPassword = readNewPassword(body);

    if (typeof suppliedCurrent !== 'string' || !suppliedCurrent) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Enter your current password'
      });
    }

    await passwordResetService.changePassword(req.user.id, suppliedCurrent, newPassword);
    // Keep the session doing the change; sign every other device out.
    const sessionsInvalidated = await sessionService.invalidateUserSessions(req.user.id, req.sessionID);
    return res.json({
      ok: true,
      sessionsInvalidated,
      message: 'Your password has been updated'
    });
  } catch (error) {
    if (error instanceof passwordResetService.PasswordResetError) {
      return res.status(400).json({ ok: false, code: error.code, message: error.message });
    }
    return next(error);
  }
};

exports.bootstrapOwner = async (req, res, next) => {
  try {
    const { name, phone_number, email, password, setup_secret: suppliedSecret } = req.body || {};
    const expectedSecret = process.env.OWNER_SETUP_SECRET;

    if (typeof expectedSecret !== 'string' || expectedSecret.length < 32) {
      return res.status(503).json({ ok: false, message: 'Owner setup requires a secret of at least 32 characters' });
    }
    if (typeof suppliedSecret !== 'string' ||
        Buffer.byteLength(suppliedSecret) !== Buffer.byteLength(expectedSecret) ||
        !crypto.timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(expectedSecret))) {
      return res.status(403).json({ ok: false, message: 'Invalid owner setup secret' });
    }
    if (!name || !phone_number || !email || !password) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const user = await authService.bootstrapOwner({ name, phone_number, email, password });
    let delivery = { sent: false, skipped: false };
    try {
      const result = await emailVerificationService.sendVerificationEmail(user);
      delivery = { sent: !!result.sent, skipped: !!result.skipped };
    } catch (error) {
      console.error(`Failed to send owner verification email to ${user.email}:`, error.message);
    }
    return res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        created_at: user.created_at,
        roles: user.roles,
        isOwner: true,
        emailVerified: false
      },
      verificationEmail: delivery,
      message: delivery.sent
        ? 'Owner created. Check your inbox for the verification link before signing in.'
        : 'Owner created, but the verification email could not be sent. Use Resend verification on the sign-in page.'
    });
  } catch (err) {
    if (err.code === 'OWNER_ALREADY_BOOTSTRAPPED') {
      return res.status(409).json({ ok: false, message: err.message });
    }
    next(err);
  }
};
