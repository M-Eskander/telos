const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const authService = require('../services/auth.service');
const pdpService = require('../services/pdp.service');

passport.use(
  new LocalStrategy({ usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const user = await authService.findUserByEmail(email);
        if (!user) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        const valid = await authService.verifyPassword(password, user.password);
        if (!valid) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        delete user.password;
        user.roles = user.roles || (await authService.getUserRoles(user.id));
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await authService.findUserById(id);
    if (!user) return done(null, false);

    user.roles = await authService.getUserRoles(id);
    delete user.password;
    done(null, user);
  } catch (err) {
    done(err);
  }
});

/**
 * Middleware to check if user has the required permission
 * @param {string} requiredPermission - e.g., "create:project"
 */
function checkPerm(requiredPermission) {
  return async (req, res, next) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ ok: false, message: 'Authentication required' });
      }

      const userId = req.user.id;
      const roles = req.user.roles || [];

      const effectivePermissions = await pdpService.getEffectivePermissions(userId, roles);

      if (!effectivePermissions.includes(requiredPermission)) {
        return res.status(403).json({ ok: false, message: 'Insufficient permissions' });
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ ok: false, message: 'Permission check failed' });
    }
  };
}

module.exports = passport;
module.exports.checkPerm = checkPerm;