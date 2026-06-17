exports.up = async function(knex) {
  // remove any partially-created table then create with compatible column types
  await knex.schema.dropTableIfExists('user_permissions');
  if (!(await knex.schema.hasTable('user_permissions'))) {
    await knex.schema.createTable('user_permissions', (table) => {
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('permission_id').unsigned().notNullable().references('id').inTable('permissions').onDelete('CASCADE');
      table.primary(['permission_id','user_id']);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_permissions');
};
