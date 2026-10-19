exports.up = async function(knex) {
  await knex.schema.alterTable('permission_attributes', table => {
    table.dropUnique(['permission_id', 'attribute_id']);
    table.integer('grant_group').notNullable().defaultTo(0);
    table.unique(['permission_id', 'grant_group', 'attribute_id']);
  });

  await knex.schema.alterTable('role_attributes', table => {
    table.dropUnique(['role_id', 'attribute_id']);
    table.unique(['role_id', 'attribute_id', 'resource_id']);
  });

  await knex.schema.alterTable('user_attributes', table => {
    table.dropUnique(['user_id', 'attribute_id']);
    table.unique(['user_id', 'attribute_id', 'resource_id']);
  });

  await knex.schema.alterTable('user_roles', table => {
    table.dropPrimary();
    table.string('resource_type').nullable();
    table.integer('resource_id').unsigned().nullable();
    table.string('scope_key', 100).notNullable().defaultTo('');
    table.unique(['user_id', 'role_id', 'scope_key']);
  });

  await knex.schema.createTable('permission_grant_groups', table => {
    table.increments('id').primary();
    table.integer('permission_id').unsigned().notNullable()
      .references('id').inTable('permissions').onDelete('CASCADE');
    table.integer('grant_group').notNullable();
    table.unique(['permission_id', 'grant_group']);
  });
  const existingGroups = await knex('permission_attributes')
    .distinct('permission_id', 'grant_group');
  if (existingGroups.length) {
    await knex('permission_grant_groups').insert(existingGroups);
  }

  await knex.schema.createTable('owner_account', table => {
    table.integer('id').primary();
    table.integer('user_id').unsigned().notNullable().unique()
      .references('id').inTable('users').onDelete('CASCADE');
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('owner_account');
  await knex.schema.dropTableIfExists('permission_grant_groups');

  await knex.schema.alterTable('user_attributes', table => {
    table.dropUnique(['user_id', 'attribute_id', 'resource_id']);
    table.unique(['user_id', 'attribute_id']);
  });

  await knex('user_roles').whereNotNull('resource_type').del();
  await knex.schema.alterTable('user_roles', table => {
    table.dropUnique(['user_id', 'role_id', 'scope_key']);
    table.dropColumn('scope_key');
    table.dropColumn('resource_id');
    table.dropColumn('resource_type');
    table.primary(['role_id', 'user_id']);
  });

  await knex.schema.alterTable('role_attributes', table => {
    table.dropUnique(['role_id', 'attribute_id', 'resource_id']);
    table.unique(['role_id', 'attribute_id']);
  });

  await knex.schema.alterTable('permission_attributes', table => {
    table.dropUnique(['permission_id', 'grant_group', 'attribute_id']);
    table.dropColumn('grant_group');
    table.unique(['permission_id', 'attribute_id']);
  });
};
