exports.up = function(knex) {
  return knex.schema.alterTable('projects', function(table) {
    table.integer('overall_progress').defaultTo(0);
    table.boolean('is_on_track').defaultTo(true); // Shows if project is on track or behind timeline[cite: 2]
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('projects', function(table) {
    table.dropColumn('overall_progress');
    table.dropColumn('is_on_track');
  });
};