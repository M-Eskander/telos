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
 * PRODUCTION PDP: Resolves all logic in one pass.
 * Replaces both getAttributes and getPermissions.
 */
async function getEffectivePermissions(userId, roles) {
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

    // 2. Check Redis cache for user permissions (user-specific)
    const cacheKey = `user_permissions:${userId}`;
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (err) {
        // Redis not available, continue without cache
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

    // 4. ATTRIBUTE RESOLUTION (RBAC + ABAC logic)
    const attrsMap = new Map(roleAttrs.map(attr => [attr.name, attr]));

    for (const ua of userAttrs) {
        if (ua.mode === 'remove') {
            attrsMap.delete(ua.name);
        } else {
            attrsMap.set(ua.name, { name: ua.name, description: ua.description || '' });
        }
    }

    const finalAttrNames = new Set(attrsMap.keys());

    // 5. PERMISSION FILTERING
    // allPermRequirements should be an object: { "post:delete": ["is_admin", "is_owner"], ... }
    const effectivePermissions = Object.keys(allPermRequirements).filter(permName => {
        const requiredAttrs = allPermRequirements[permName];
        
        // Logical AND: User must have EVERY attribute required by the permission
        return requiredAttrs.every(attrName => finalAttrNames.has(attrName));
    });

    // 6. Cache the result
    try {
        await redisClient.setEx(cacheKey, 300, JSON.stringify(effectivePermissions)); // 5 min TTL
    } catch (err) {
        // Ignore cache errors
    }

    return effectivePermissions;
}

module.exports = { getEffectivePermissions, _clearCache };