const knex = require('../config/knex');

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

module.exports = {
    getAttributesByRole,
    insertOrUpdateAttributes
};