exports.up = async function(knex) {
  await knex.schema.createTable('project_departments', table => {
    table.increments('id').primary();
    table.integer('project_id').unsigned().notNullable()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);
    table.unique(['project_id', 'name']);
  });

  await knex.schema.createTable('project_memberships', table => {
    table.increments('id').primary();
    table.integer('project_id').unsigned().notNullable()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('department_id').unsigned().nullable()
      .references('id').inTable('project_departments').onDelete('SET NULL');
    table.timestamps(true, true);
    table.unique(['project_id', 'user_id']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('project_memberships');
  await knex.schema.dropTableIfExists('project_departments');
};
