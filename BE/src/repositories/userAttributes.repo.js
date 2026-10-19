const knex = require('../config/knex');
const redisClient = require('../redis/client');

async function getAttributesByUser(userId) {
    return knex('user_attributes')
        .join('attributes', 'user_attributes.attribute_id', 'attributes.id')
        .where({ user_id: userId })
        .select(
            'attributes.name',
            'attributes.resource',
            'user_attributes.resource_id',
            'user_attributes.mode',
            'user_attributes.value'
        );
}

async function insertOrUpdateAttributes(userId, attributes) {
    const existing = await getAttributesByUser(userId);
    if (existing.length > 0) {
        return knex('user_attributes').where({user_id: userId}).update({attributes}).returning('*');
    } else {
        return knex('user_attributes').insert({user_id: userId, attributes}).returning('*');
    }
}

/**
 * Add or update a user attribute with automatic cache invalidation
 * @param {number} userId - User ID
 * @param {string} attributeName - Attribute name
 * @param {string} mode - 'add' or 'remove'
 * @param {object} trx - Optional Knex transaction
 * @returns {object} Created/updated user attribute record
 */
async function addUserAttribute(userId, attributeName, mode = 'add', trx = null, resourceId = null) {
    const db = trx || knex;
    
    try {
        // Get attribute ID
        const attribute = await db('attributes')
            .where({ name: attributeName })
            .first();
        
        if (!attribute) {
            throw new Error(`Attribute not found: ${attributeName}`);
        }

        // Insert or update user attribute
        const existing = await db('user_attributes')
            .where({ user_id: userId, attribute_id: attribute.id, resource_id: resourceId })
            .first();

        let result;
        if (existing) {
            result = await db('user_attributes')
                .where({ id: existing.id })
                .update({ mode, updated_at: new Date() })
                .returning('*');
        } else {
            result = await db('user_attributes')
                .insert({
                    user_id: userId,
                    attribute_id: attribute.id,
                    resource_id: resourceId,
                    value: 'true',
                    mode,
                    created_at: new Date()
                })
                .returning('*');
        }

        // Invalidate cache immediately
        await invalidateUserPermissionCache(userId);
        
        return result[0] || result;
    } catch (err) {
        console.error(`Failed to add user attribute: ${err.message}`);
        throw err;
    }
}

/**
 * Remove a user attribute with automatic cache invalidation
 * @param {number} userId - User ID
 * @param {string} attributeName - Attribute name
 * @param {object} trx - Optional Knex transaction
 * @returns {boolean} True if removed, false if not found
 */
async function removeUserAttribute(userId, attributeName, trx = null, resourceId = null) {
    const db = trx || knex;
    
    try {
        // Get attribute ID
        const attribute = await db('attributes')
            .where({ name: attributeName })
            .first();
        
        if (!attribute) {
            throw new Error(`Attribute not found: ${attributeName}`);
        }

        // Delete user attribute
        const deleted = await db('user_attributes')
            .where({ user_id: userId, attribute_id: attribute.id, resource_id: resourceId })
            .delete();

        if (deleted > 0) {
            // Invalidate cache immediately
            await invalidateUserPermissionCache(userId);
            return true;
        }
        
        return false;
    } catch (err) {
        console.error(`Failed to remove user attribute: ${err.message}`);
        throw err;
    }
}

/**
 * Invalidate user permission cache in Redis
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
async function invalidateUserPermissionCache(userId) {
    try {
        if (redisClient.isOpen || redisClient.isReady) {
            const keys = await redisClient.keys(`user_permissions:${userId}*`);
            if (keys.length) await redisClient.del(...keys);
        }
    } catch (err) {
        // Log but don't fail if Redis unavailable
        console.warn(`Failed to invalidate cache for user ${userId}: ${err.message}`);
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

        const keys = (await Promise.all(users.map(user =>
            redisClient.keys(`user_permissions:${user.user_id}*`)
        ))).flat();
        if (keys.length) await redisClient.del(...new Set(keys));
        
        console.log(`Invalidated caches for ${users.length} users (role ${roleId})`);
    } catch (err) {
        console.warn(`Failed to invalidate role cache: ${err.message}`);
    }
}

module.exports = {
    getAttributesByUser,
    insertOrUpdateAttributes,
    addUserAttribute,
    removeUserAttribute,
    invalidateUserPermissionCache,
    invalidateRolePermissionCache
};