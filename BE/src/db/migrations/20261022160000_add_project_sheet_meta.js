exports.up = function(knex) {
  return knex.schema.alterTable('project_sheets', function(table) {
    // Column widths, row heights, merges and the chosen frozen header/column,
    // so the quick grid can look like the workbook it came from.
    table.json('meta').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('project_sheets', function(table) {
    table.dropColumn('meta');
  });
};
