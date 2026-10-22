// The studio has two kinds of paper:
//   - Terms: the studio-wide agreement every person signs to come aboard.
//   - Contract: a per-project agreement, made from that project's layout and
//     the person's row in the project sheet.
// The end date of either is optional: a contract can run open-ended.
exports.up = function(knex) {
  return knex.schema.alterTable('contracts', function(table) {
    table.string('kind', 24).notNullable().defaultTo('terms');
    table.integer('project_id').unsigned().nullable()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.integer('template_id').unsigned().nullable();
    table.json('document_data').nullable();
    table.string('status', 24).notNullable().defaultTo('active');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('contracts', function(table) {
    table.dropColumn('kind');
    table.dropColumn('project_id');
    table.dropColumn('template_id');
    table.dropColumn('document_data');
    table.dropColumn('status');
  });
};
