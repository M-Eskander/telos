// 20260407_create_permissions_and_permission_attributes.js

exports.up = async function(knex) {
  // 🔹 permissions table
  if (!(await knex.schema.hasTable('permissions'))) {
    await knex.schema.createTable('permissions', (table) => {
      table.increments('id').primary();
      table.string('action', 50).notNullable();
      table.string('resource', 50).notNullable();
      table.string('description');
      table.unique(['action', 'resource']);
      table.timestamps(true, true);
    });
  }

  // 🔹 permission_attributes table
  if (!(await knex.schema.hasTable('permission_attributes'))) {
    await knex.schema.createTable('permission_attributes', (table) => {
      table.increments('id').primary();

      table.integer('permission_id')
        .notNullable()
        .references('id')
        .inTable('permissions')
        .onDelete('CASCADE');

      table.integer('attribute_id').unsigned().notNullable()
         .references('id').inTable('attributes').onDelete('CASCADE');
         
      table.unique(['permission_id', 'attribute_id']);
      table.timestamps(true, true);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema
    .dropTableIfExists('permission_attributes')
    .dropTableIfExists('permissions');
};