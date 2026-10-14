/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('departments', function(table) {
      table.increments('id').primary();
      table.string('name').notNullable().unique();
      table.timestamps(true, true);
    })

    .createTable('team_memberships', function(table) {
      table.increments('id').primary();
      table.integer('team_id').unsigned().references('id').inTable('teams').onDelete('CASCADE');
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      table.integer('department_id').unsigned().references('id').inTable('departments').onDelete('SET NULL').nullable();
      table.string('role_in_team').nullable(); // e.g., Lead Programmer, 3D Artist
      table.timestamps(true, true);
      
      table.unique(['team_id', 'user_id']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTable('team_memberships')
    .dropTable('departments')
};
