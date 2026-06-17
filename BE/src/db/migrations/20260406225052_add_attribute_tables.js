exports.up = async function(knex) {
  // 1. Clear out the mess from previous failed attempts
  await knex.schema.dropTableIfExists('user_attributes');
  await knex.schema.dropTableIfExists('role_attributes');
  await knex.schema.dropTableIfExists('attributes');
  await knex.schema.dropTableIfExists('user_permissions');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');

  // 2. Create Attributes
  await knex.schema.createTable('attributes', table => {
    table.increments('id').primary(); 
    table.string('name', 50).notNullable().unique();
    table.text('description');
    table.timestamps(true, true);
  });

  // 3. Create Role Attributes (The .unsigned() is mandatory here)
  await knex.schema.createTable('role_attributes', table => {
    table.increments('id').primary();
 table.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
     table.integer('attribute_id').unsigned().notNullable()
         .references('id').inTable('attributes').onDelete('CASCADE');
    table.string('value').notNullable();
    table.unique(['role_id', 'attribute_id']);
    table.timestamps(true, true);
  });

  // 4. Create User Attributes
  await knex.schema.createTable('user_attributes', table => {
    table.increments('id').primary();
     table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('attribute_id').unsigned().notNullable()
         .references('id').inTable('attributes').onDelete('CASCADE');
    table.string('value').notNullable();
    table.unique(['user_id', 'attribute_id']);
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_attributes');
  await knex.schema.dropTableIfExists('role_attributes');
  await knex.schema.dropTableIfExists('attributes');
};