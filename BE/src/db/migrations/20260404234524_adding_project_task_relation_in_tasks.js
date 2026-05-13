/**
 * Migration: add project_id to tasks table
 */

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('tasks', 'project_id');
  if (!hasColumn) {
    await knex.schema.alterTable('tasks', (table) => {
      table
        .integer('project_id')
        .unsigned()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE');
    });
  }
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('tasks', 'project_id');
  if (hasColumn) {
    await knex.schema.alterTable('tasks', (table) => {
      table.dropColumn('project_id');
    });
  }
};