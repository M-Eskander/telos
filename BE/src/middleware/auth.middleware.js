const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const authService = require('../services/auth.service');
const pdpService = require('../services/pdp.service');

// Absolute relative imports from src/middleware/
const projectRepo = require('../repositories/project.repo');
const taskRepo = require('../repositories/task.repo');

function maySignInBeforeVerification(user) {
  return !!user.email_verified_at || !!user.email_verification_deferred_at;
}

passport.use(
  new LocalStrategy({ usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const user = await authService.findUserByEmail(email);
        if (!user || user.is_active === false || Number(user.is_active) === 0) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        const valid = await authService.verifyPassword(password, user.password);
        if (!valid) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        const isOwner = await authService.isOwner(user.id);
        if (!maySignInBeforeVerification(user)) {
          return done(null, false, {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Your email address has not been verified yet. Open the link we emailed you, then sign in again.',
            email: user.email
          });
        }

        delete user.password;
        user.roles = user.roles || (await authService.getUserRoleAssignments(user.id));
        user.isOwner = isOwner;
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
    if (!user || user.is_active === false || Number(user.is_active) === 0) return done(null, false);

    user.roles = await authService.getUserRoleAssignments(id);
    user.isOwner = await authService.isOwner(id);
    if (!maySignInBeforeVerification(user)) return done(null, false);
    delete user.password;
    done(null, user);
  } catch (err) {
    done(err);
  }
});

/**
 * Registry mapping resource names to their real database lookups
 */
const resourceResolvers = {
  project: async (id, userId = null) => {
    return await projectRepo.getProjectById(id);
  },
  task: async (id, userId = null) => {
    return await taskRepo.findById(id, userId);
  }
};

function normalizePermission(permission, resourceType = null) {
  if (!permission) return permission;
  if (permission.includes(':')) return permission;
  if (resourceType) return `${permission}:${resourceType}`;
  return permission;
}

/**
 * Middleware to check if user has the required permission mapped to a real resource
 */
function checkPerm(requiredPermission, resourceType = null, idParamName = 'id') {
  return async (req, res, next) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ ok: false, message: 'Authentication required' });
      }

      const userId = req.user.id;
      const roles = req.user.roles || [];
      if (req.user.isOwner === true) return next();
      const normalizedPermission = normalizePermission(requiredPermission, resourceType);
      
      let context = null;

      if (resourceType && req.params[idParamName]) {
        const resourceId = req.params[idParamName];
        const resolver = resourceResolvers[resourceType];

        if (resolver) {
          const realResource = await resolver(resourceId, userId);
          
          if (!realResource) {
            return res.status(404).json({ ok: false, message: `${resourceType} not found` });
          }

          context = {
            resourceId: realResource.id,
            resourceType: resourceType,
            ownerId: realResource.created_by 
          };

          req[resourceType] = realResource;
        }
      }

      const effectivePermissions = await pdpService.getEffectivePermissions(userId, roles, context);
      req.effectivePermissions = effectivePermissions;

      if (!effectivePermissions.includes(normalizedPermission)) {
        return res.status(403).json({ ok: false, message: 'Insufficient permissions' });
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ ok: false, message: 'Permission check failed' });
    }
  };
}

function requireAuthenticated(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ ok: false, message: 'Authentication required' });
  }
  next();
}

function requireOwner(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ ok: false, message: 'Authentication required' });
  }
  if (req.user.isOwner !== true) {
    return res.status(403).json({ ok: false, message: 'Owner access required' });
  }
  next();
}

module.exports = passport;
module.exports.checkPerm = checkPerm;
module.exports.requireAuthenticated = requireAuthenticated;
module.exports.requireOwner = requireOwner;