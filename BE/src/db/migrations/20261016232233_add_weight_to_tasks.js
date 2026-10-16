exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.decimal('weight', 10, 2).nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('weight');
  });
};
