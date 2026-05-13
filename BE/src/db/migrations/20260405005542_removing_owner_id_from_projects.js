// migrations/20260405_remove_owner_id_from_projects.js

exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('projects', 'owner_id');
  if (hasColumn) {
    await knex.schema.table('projects', (table) => {
      table.dropColumn('owner_id');
    });
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('projects', 'owner_id');
  if (!hasColumn) {
    await knex.schema.table('projects', (table) => {
      table.integer('owner_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }
};