const passport = require('../middleware/auth.middleware');
const authService = require('../services/auth.service');
const crypto = require('crypto');

function serializeRoleAssignments(roles) {
  return (roles || []).map(role => typeof role === 'string'
    ? { name: role, resourceType: null, resourceId: null }
    : {
      name: role.name,
      resourceType: role.resourceType || null,
      resourceId: role.resourceId || null
    });
}

exports.login = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ ok: false, message: info && info.message });
    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          roles: serializeRoleAssignments(user.roles).map(role => role.name),
          roleAssignments: serializeRoleAssignments(user.roles),
          isOwner: user.isOwner
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

exports.me = (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ ok: false });
  res.json({
    ok: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      roles: serializeRoleAssignments(req.user.roles).map(role => role.name),
      roleAssignments: serializeRoleAssignments(req.user.roles),
      isOwner: req.user.isOwner
    }
  });
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
    return res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        created_at: user.created_at,
        roles: user.roles,
        isOwner: true
      }
    });
  } catch (err) {
    if (err.code === 'OWNER_ALREADY_BOOTSTRAPPED') {
      return res.status(409).json({ ok: false, message: err.message });
    }
    next(err);
  }
};
