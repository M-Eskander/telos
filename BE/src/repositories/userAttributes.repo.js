const knex = require('../config/knex');

async function getAttributesByUser(userId) {
    return knex('user_attributes')
        .join('attributes', 'user_attributes.attribute_id', 'attributes.id')
        .where({ user_id: userId })
        .select('attributes.name', 'user_attributes.mode', 'user_attributes.value');
}

async function insertOrUpdateAttributes(userId, attributes) {
    const existing = await getAttributesByUser(userId);
    if (existing.length > 0) {
        return knex('user_attributes').where({user_id: userId}).update({attributes}).returning('*');
    } else {
        return knex('user_attributes').insert({user_id: userId, attributes}).returning('*');
    }
}

module.exports = {
    getAttributesByUser,
    insertOrUpdateAttributes
};