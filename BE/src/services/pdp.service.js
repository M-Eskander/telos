// src/services/pdp.service.js

const userAttributesRepo = require('../repositories/userAttributes.repo');
const roleAttributesRepo = require('../repositories/roleAttributes.repos');
const permissionAttributesRepo = require('../repositories/permissionAttributes.repo');
const redisClient = require('../redis/client');

let permissionRequirementsCache = null;
let cacheExpiry = 0;

// For testing: function to clear cache
const _clearCache = () => {
  permissionRequirementsCache = null;
  cacheExpiry = 0;
};

/**
 * Invalidate all permission caches in Redis
 * Useful for administrative operations that affect many users
 * @returns {Promise<number>} Number of keys deleted
 */
async function invalidateAllPermissionCaches() {
  try {
    if (!redisClient.isOpen && !redisClient.isReady) {
      console.warn('Redis not available for cache invalidation');
      return 0;
    }

    // Delete all user_permissions:* keys
    const keys = await redisClient.keys('user_permissions:*');
    let deleted = 0;

    if (keys.length > 0) {
      deleted = await redisClient.del(...keys);
      console.log(`Invalidated ${deleted} user permission caches globally`);
    }

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
    if (!redisClient.isOpen && !redisClient.isReady) {
      return false;
    }

    // Scan for both the base user key and any resource-scoped keys matching that user
    const keys = await redisClient.keys(`user_permissions:${userId}*`);
    
    if (keys.length > 0) {
      const deleted = await redisClient.del(...keys); 
      console.log(`Cache invalidated: Cleared ${deleted} cache segments for user ${userId}`);
      return true;
    }
    
    return false;
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
    // We store composite tokens: "attributeName:resourceName"
    const activeAttributes = new Set();

    // Add role-based attributes
    for (const attr of roleAttrs) {
        activeAttributes.add(`${attr.name}:${attr.resource}`);
    }

    // CRITICAL ADDITION: Dynamic context injection
    // Maps the contextual owner info at request time to attributes
    if (context && context.ownerId === userId && context.resourceType) {
        activeAttributes.add(`is_owner:${context.resourceType}`);
    }

    // Overlay user-specific attribute overrides
    for (const ua of userAttrs) {
        const compositeKey = `${ua.name}:${ua.resource}`;
        if (ua.mode === 'remove') {
            activeAttributes.delete(compositeKey);
        } else {
            activeAttributes.add(compositeKey);
        }
    }

    // 5. PERMISSION FILTERING
    // Assumes allPermRequirements is structured like: 
    // { "post:delete": [{ name: "is_owner", resource: "post" }, { name: "is_admin", resource: "global" }] }
    const effectivePermissions = Object.keys(allPermRequirements).filter(permName => {
        const requiredAttrs = allPermRequirements[permName];
        
        // Logical AND: User must have EVERY (name + resource) combo required by the permission
        return requiredAttrs.every(req => activeAttributes.has(`${req.name}:${req.resource}`));
    });

// 6. Cache the result (Only cache if there's no unique resource instance context)

    try {
        // Save to the key determined above (global or resource-scoped)
        await redisClient.setEx(cacheKey, 300, JSON.stringify(effectivePermissions)); // 5 min TTL
    } catch (err) {
        // Ignore cache errors
    }
    
    
    return effectivePermissions;
  }


module.exports = { 
    getEffectivePermissions, 
    invalidateUserPermissionCache,
    invalidateAllPermissionCaches,
    _clearCache 
};