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

function buildCompositeKey(name, resource, resourceId) {
  return resourceId !== undefined && resourceId !== null
    ? `${name}:${resource}:${resourceId}`
    : `${name}:${resource}`;
}

function normalizeGrantGroups(requirements) {
    if (!Array.isArray(requirements) || requirements.length === 0) {
        return [[]];
    }
    return Array.isArray(requirements[0]) ? requirements : [requirements];
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

    if (keys.length === 0) {
      return false;
    }

    let deleted = 0;
    for (const key of keys) {
      deleted += await redisClient.del(key);
    }

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
    const roleAssignments = roles.map(role => typeof role === 'object'
        ? role
        : { name: role });
    const roleAttrsPromises = roleAssignments.map(role =>
        roleAttributesRepo.getAttributesByRole(role.name)
    );
    const [roleAttrsArrays, userAttrs] = await Promise.all([
        Promise.all(roleAttrsPromises),
        userAttributesRepo.getAttributesByUser(userId)
    ]);

    const roleAttrs = roleAttrsArrays.flatMap((attributes, index) => {
        const assignment = roleAssignments[index];
        if (!assignment.resourceType) return attributes;
        if (!context || context.resourceType !== assignment.resourceType ||
            String(context.resourceId) !== String(assignment.resourceId)) {
            return [];
        }
        return attributes
            .filter(attr => attr.resource === assignment.resourceType &&
                (attr.resource_id === null || attr.resource_id === undefined ||
                    String(attr.resource_id) === String(assignment.resourceId)))
            .map(attr => ({ ...attr, resource_id: assignment.resourceId }));
    });

   // 4. ATTRIBUTE RESOLUTION (RBAC + ABAC logic scoped by resource)
    // We store composite tokens: "attributeName:resourceName" (v1) or
    // "attributeName:resourceName:resourceId" (v2, once repos return resource_id). as we currently do
    const activeAttributes = new Set();
    const removedAttributes = new Set();

    // Add role-based attributes
    for (const attr of roleAttrs) {
        activeAttributes.add(buildCompositeKey(attr.name, attr.resource, attr.resource_id));
    }

    // CRITICAL ADDITION: Dynamic context injection
    // Maps the contextual owner info at request time to attributes
    if (context && context.ownerId === userId && context.resourceType) {
        activeAttributes.add(`is_owner:${context.resourceType}`);

        if (context.resourceId !== undefined && context.resourceId !== null) {
            activeAttributes.add(`is_owner:${context.resourceType}:${context.resourceId}`);
        }
    }

    // Overlay user-specific attribute overrides
    for (const ua of userAttrs) {
        const compositeKey = buildCompositeKey(ua.name, ua.resource, ua.resource_id);
        if (ua.mode === 'remove') {
            removedAttributes.add(compositeKey);
            activeAttributes.delete(compositeKey);
        } else {
            activeAttributes.add(compositeKey);
            removedAttributes.delete(compositeKey);
        }
    }

    // 5. PERMISSION FILTERING

    // Attributes in a grant group are ANDed; separate groups are alternatives.
    const effectivePermissions = Object.keys(allPermRequirements).filter(permName => {
        const grantGroups = normalizeGrantGroups(allPermRequirements[permName]);
        return grantGroups.some(requiredAttrs =>
            requiredAttrs.every(req => {
                const contextResourceId = context && context.resourceType === req.resource
                    ? context.resourceId
                    : undefined;
                const resourceId = req.resourceId !== undefined && req.resourceId !== null
                    ? req.resourceId
                    : contextResourceId;
                const scopedKey = buildCompositeKey(req.name, req.resource, resourceId);
                const typeKey = buildCompositeKey(req.name, req.resource);

                if (removedAttributes.has(scopedKey) || removedAttributes.has(typeKey)) {
                    return false;
                }
                return activeAttributes.has(scopedKey) || activeAttributes.has(typeKey);
            })
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
    clearPermissionRequirementCache: _clearCache,
    _clearCache,
    // exported for unit testing the key-building rule in isolation
    _buildCompositeKey: buildCompositeKey
};