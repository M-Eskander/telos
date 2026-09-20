// src/services/pdp.service.js

const userAttributesRepo = require('../repositories/userAttributes.repo');
const roleAttributesRepo = require('../repositories/roleAttributes.repos');
const permissionAttributesRepo = require('../repositories/permissionAttributes.repo');
const redisClient = require('../redis/client');

let permissionRequirementsCache = null;
let cacheExpiry = 0;

function redisIsAvailable() {
  return !!redisClient && (redisClient.isOpen === true || redisClient.isReady === true);
}

// For testing: function to clear cache
const _clearCache = () => {
  permissionRequirementsCache = null;
  cacheExpiry = 0;
};

/**
 * Build the composite attribute key used for matching.
 *
 * v1 behavior (unchanged): resourceId is absent/undefined from the repos
 * today, so this always resolves to `${name}:${resource}` — a type/global
 * level key, exactly as before.
 *
 * Forward-looking (v2): once the repos start selecting `resource_id` from
 * role_attributes / user_attributes (added via migration
 * 20260803195906_add_resource_id_to_attribute_joins.js), a truthy
 * resourceId will produce an instance-scoped key instead:
 *   `${name}:${resource}:${resourceId}`
 * No caller changes are needed when that happens — this function is the
 * single place scope keys get built.
 */
function buildCompositeKey(name, resource, resourceId) {
  return resourceId !== undefined && resourceId !== null
    ? `${name}:${resource}:${resourceId}`
    : `${name}:${resource}`;
}

/**
 * Invalidate all permission caches in Redis
 * Useful for administrative operations that affect many users
 * @returns {Promise<number>} Number of keys deleted
 */
async function invalidateAllPermissionCaches() {
  try {
    if (!redisIsAvailable()) {
      console.warn('Redis not available for cache invalidation');
      return 0;
    }

    const keys = await redisClient.keys('user_permissions:*');
    console.log(`invalidateAllPermissionCaches: found ${keys.length} keys`);

    if (keys.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (const key of keys) {
      deleted += await redisClient.del(key);
    }

    console.log(`Invalidated ${deleted} user permission caches globally`);
    return deleted;
  } catch (err) {
    console.error(`Failed to invalidate all permission caches: ${err.message}`);
    throw err;
  }
}

/**
 * Invalidate permission cache for specific user, including resource-scoped keys
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True if caches were deleted
 */
async function invalidateUserPermissionCache(userId) {
  try {
    if (!redisIsAvailable()) {
      return false;
    }

    const keys = await redisClient.keys(`user_permissions:${userId}*`);
    console.log(`invalidateUserPermissionCache: found keys for user ${userId}:`, keys);

    if (keys.length === 0) {
      return false;
    }

    let deleted = 0;
    for (const key of keys) {
      deleted += await redisClient.del(key);
    }

    console.log(`Cache invalidated: Cleared ${deleted} cache segments for user ${userId}`);
    return deleted > 0;
  } catch (err) {
    console.warn(`Failed to invalidate cache for user ${userId}: ${err.message}`);
    return false;
  }
}

/**
 * PRODUCTION PDP: Resolves all logic in one pass.
 * Replaces both getAttributes and getPermissions.
 */
async function getEffectivePermissions(userId, roles, context) {
    // 1. Check cache for permission requirements (global, changes rarely)
    const now = Date.now();
    if (!permissionRequirementsCache || now > cacheExpiry) {
        try {
            permissionRequirementsCache = await permissionAttributesRepo.getAllPermissionRequirements();
            cacheExpiry = now + (5 * 60 * 1000); // 5 minutes
        } catch (err) {
            console.error('Failed to load permission requirements:', err);
            throw err;
        }
    }
    const allPermRequirements = permissionRequirementsCache;

    console.log('PDP: permission requirements loaded:', JSON.stringify(allPermRequirements));

    // 2. Check Redis cache for user permissions (Context-Aware)
    let cacheKey = `user_permissions:${userId}`;
    if (context && context.resourceType && context.resourceId) {
        // Generates e.g., user_permissions:1:task:42
        cacheKey = `user_permissions:${userId}:${context.resourceType}:${context.resourceId}`;
    }

    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (err) {
        console.warn('Redis not available for caching');
    }

    // 3. DATA GATHERING (The "Hot" IO phase)
    // We fetch everything in parallel to minimize latency
    const roleNames = roles.map(r => typeof r === 'object' ? r.name : r);
    const roleAttrsPromises = roleNames.map(roleName => roleAttributesRepo.getAttributesByRole(roleName));
    const [roleAttrsArrays, userAttrs] = await Promise.all([
        Promise.all(roleAttrsPromises),
        userAttributesRepo.getAttributesByUser(userId)
    ]);

    // Merge role attributes
    const roleAttrs = roleAttrsArrays.flat();

   // 4. ATTRIBUTE RESOLUTION (RBAC + ABAC logic scoped by resource)
    // We store composite tokens: "attributeName:resourceName" (v1) or
    // "attributeName:resourceName:resourceId" (v2, once repos return resource_id).
    const activeAttributes = new Set();

    // Add role-based attributes
    for (const attr of roleAttrs) {
        // attr.resource_id is undefined today (repos don't select it yet),
        // so this is a no-op change for v1 — buildCompositeKey falls back
        // to the plain "name:resource" key.
        activeAttributes.add(buildCompositeKey(attr.name, attr.resource, attr.resource_id));
    }

    // CRITICAL ADDITION: Dynamic context injection
    // Maps the contextual owner info at request time to attributes
    if (context && context.ownerId === userId && context.resourceType) {
        activeAttributes.add(`is_owner:${context.resourceType}`);

        // Forward-looking: also record an instance-scoped ownership token
        // when we know which specific resource this is. Unused by any
        // permission requirement today, so this is purely additive and
        // does not change v1 matching behavior.
        if (context.resourceId !== undefined && context.resourceId !== null) {
            activeAttributes.add(`is_owner:${context.resourceType}:${context.resourceId}`);
        }
    }

    // Overlay user-specific attribute overrides
    for (const ua of userAttrs) {
        // Same v1/v2 note as role attributes above.
        const compositeKey = buildCompositeKey(ua.name, ua.resource, ua.resource_id);
        if (ua.mode === 'remove') {
            activeAttributes.delete(compositeKey);
        } else {
            activeAttributes.add(compositeKey);
        }
    }

    // 5. PERMISSION FILTERING
    // Assumes allPermRequirements is structured like:
    // { "post:delete": [{ name: "is_owner", resource: "post" }, { name: "is_admin", resource: "global" }] }
    //
    // v1: requirements never carry a resourceId, so buildCompositeKey below
    // always resolves to the plain "name:resource" key — identical to prior
    // behavior. Once requirements can be instance-scoped, requiring
    // req.resourceId will match against the finer-grained key automatically.
    const effectivePermissions = Object.keys(allPermRequirements).filter(permName => {
        const requiredAttrs = allPermRequirements[permName];

        // Logical AND: User must have EVERY (name + resource[+ resourceId]) combo required by the permission
        return requiredAttrs.every(req =>
            activeAttributes.has(buildCompositeKey(req.name, req.resource, req.resourceId))
        );
    });

    console.log('PDP: activeAttributes:', Array.from(activeAttributes));
    console.log('PDP: effectivePermissions calculated:', effectivePermissions);

// 6. Cache the result only when Redis is actually available
    try {
        if (redisIsAvailable()) {
            await redisClient.setEx(cacheKey, 300, JSON.stringify(effectivePermissions)); // 5 min TTL
        }
    } catch (err) {
        // Ignore cache errors
    }


    return effectivePermissions;
  }


module.exports = {
    getEffectivePermissions,
    invalidateUserPermissionCache,
    invalidateAllPermissionCaches,
    _clearCache,
    // exported for unit testing the key-building rule in isolation
    _buildCompositeKey: buildCompositeKey
};