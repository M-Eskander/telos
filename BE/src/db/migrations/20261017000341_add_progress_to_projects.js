exports.up = function(knex) {
  return knex.schema.alterTable('projects', function(table) {
    table.integer('progress').defaultTo(0);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('projects', function(table) {
    table.dropColumn('progress');
  });
};
