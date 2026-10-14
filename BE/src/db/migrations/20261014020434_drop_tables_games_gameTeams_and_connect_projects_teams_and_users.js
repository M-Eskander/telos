exports.up = function(knex) {
  return knex.schema
    // 1. Drop old unused tables in correct order (respecting foreign key constraints)
    .dropTableIfExists('game_teams')
    .dropTableIfExists('games')


    // 4. Team memberships linking users to teams with their department & role
    .createTable('project_teams', function(table) {
      table.increments('id').primary();
      table.integer('project_id').unsigned().references('id').inTable('projects').onDelete('CASCADE');
      table.integer('team_id').unsigned().references('id').inTable('teams').onDelete('CASCADE');
      table.timestamps(true, true);
      
      // Ensure a team isn't duplicated on the same project
      table.unique(['project_id', 'team_id']);
    })
};

exports.down = function(knex) {
  return knex.schema
    .dropTable('project_teams')
    .createTable('games', function(table) {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.string('cover_image').nullable();
      table.decimal('price', 10, 2).nullable();
      table.timestamps(true, true);
    })
    .createTable('game_teams', function(table) {
      table.increments('id').primary();
      table.integer('game_id').unsigned().references('id').inTable('games').onDelete('CASCADE');
      table.integer('team_id').unsigned().references('id').inTable('teams').onDelete('CASCADE');
    });
};