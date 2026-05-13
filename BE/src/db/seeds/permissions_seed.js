exports.seed = async function(knex) {
  await knex('permissions').del();

  await knex('permissions').insert([
    { action: 'create', resource: 'project' },
    { action: 'read', resource: 'project' },
    { action: 'update', resource: 'project' },
    { action: 'delete', resource: 'project' },

    { action: 'create', resource: 'task' },
    { action: 'read', resource: 'task' },
    { action: 'update', resource: 'task' },
    { action: 'delete', resource: 'task' },

    { action: 'assign', resource: 'task' },
  ]);
};