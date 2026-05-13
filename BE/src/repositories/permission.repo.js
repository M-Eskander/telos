const knex = require('../config/knex');

function getPermissionById(id) {
    return knex('permissions').where({id}).first();
}

function getPermissionByName(name) {
    return knex('permissions').where({name}).first();
}

function insertPermission(name, description) {
    return knex('permissions').insert({name, description}).returning('*');
}

function listPermissions() {
    return knex('permissions').select('*');
}

function deletePermission(id) {
    return knex('permissions').where({id}).del();
}

module.exports = {
    getPermissionById,
    getPermissionByName,
    insertPermission,
    listPermissions,
    deletePermission
};
