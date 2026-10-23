// A project contract is either made from the project's Word layout or uploaded
// directly for one member. The source keeps the two kinds apart, so a sheet
// generation never silently replaces a signed PDF that was uploaded.
exports.up = async function(knex) {
  if (await knex.schema.hasColumn('project_contracts', 'source')) return;
  await knex.schema.alterTable('project_contracts', function(table) {
    table.string('source', 24).notNullable().defaultTo('generated');
    table.index(['project_id', 'user_id'], 'project_contracts_project_user_idx');
  });
};

exports.down = async function(knex) {
  if (!await knex.schema.hasColumn('project_contracts', 'source')) return;
  await knex.schema.alterTable('project_contracts', function(table) {
    table.dropIndex(['project_id', 'user_id'], 'project_contracts_project_user_idx');
    table.dropColumn('source');
  });
};
