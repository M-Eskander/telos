const knex = require('../config/knex');
const redisClient = require('../redis/client');

async function getAttributesByRole(roleName) {
    const role = await knex('roles').where({ name: roleName }).first();
    if (!role) return [];
    return knex('role_attributes')
        .join('attributes', 'role_attributes.attribute_id', 'attributes.id')
        .where({ role_id: role.id })
        .select('attributes.name', 'attributes.description');
}

async function insertOrUpdateAttributes(roleId, attributes) {
    const existing = await getAttributesByRole(roleId);
    if (existing.length > 0) {
        return knex('role_attributes').where({role_id: roleId}).update({attributes}).returning('*');
    } else {
        return knex('role_attributes').insert({role_id: roleId, attributes}).returning('*');
    }
}

/**
 * Link a role to an attribute with automatic cache invalidation
 * @param {number} roleId - Role ID
 * @param {number} attributeId - Attribute ID
 * @param {object} trx - Optional Knex transaction
 * @returns {object} Created link record
 */
async function linkRoleAttribute(roleId, attributeId, trx = null) {
    const db = trx || knex;
    
    try {
        // Check if already linked
        const existing = await db('role_attributes')
            .where({ role_id: roleId, attribute_id: attributeId })
            .first();

        if (existing) {
            return existing;
        }

        // Create link
        const result = await db('role_attributes')
            .insert({ role_id: roleId, attribute_id: attributeId })
            .returning('*');

        // Invalidate all users with this role
        await invalidateRolePermissionCache(roleId);
        
        return result[0] || result;
    } catch (err) {
        console.error(`Failed to link role attribute: ${err.message}`);
        throw err;
    }
}

/**
 * Unlink a role from an attribute with automatic cache invalidation
 * @param {number} roleId - Role ID
 * @param {number} attributeId - Attribute ID
 * @param {object} trx - Optional Knex transaction
 * @returns {boolean} True if removed, false if not found
 */
async function removeRoleAttribute(roleId, attributeId, trx = null) {
    const db = trx || knex;
    
    try {
        const deleted = await db('role_attributes')
            .where({ role_id: roleId, attribute_id: attributeId })
            .delete();

        if (deleted > 0) {
            // Invalidate all users with this role
            await invalidateRolePermissionCache(roleId);
            return true;
        }
        
        return false;
    } catch (err) {
        console.error(`Failed to remove role attribute: ${err.message}`);
        throw err;
    }
}

/**
 * Invalidate all user permission caches for a role change
 * @param {number} roleId - Role ID
 * @returns {Promise<void>}
 */
async function invalidateRolePermissionCache(roleId) {
    try {
        if (!redisClient.isOpen && !redisClient.isReady) {
            return;
        }

        // Find all users with this role
        const users = await knex('user_roles')
            .where({ role_id: roleId })
            .select('user_id');

        // Invalidate cache for each user
        const cacheKeys = users.map(u => `user_permissions:${u.user_id}`);
        
        if (cacheKeys.length > 0) {
            const deleted = await redisClient.del(...cacheKeys);
            console.log(`Invalidated ${deleted} permission caches for role ${roleId}`);
        }
    } catch (err) {
        // Log but don't fail if Redis unavailable
        console.warn(`Failed to invalidate role cache: ${err.message}`);
    }
}

module.exports = {
    getAttributesByRole,
    insertOrUpdateAttributes,
    linkRoleAttribute,
    removeRoleAttribute,
    invalidateRolePermissionCache
};