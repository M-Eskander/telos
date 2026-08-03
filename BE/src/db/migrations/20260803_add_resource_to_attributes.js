/**
 * Adds a `resource` column to attributes, defaulting to 'global'.
 *
 * This is what pdp.service.js expects on every attribute row so it can
 * build composite keys like `${name}:${resource}` (e.g. "is_admin:global",
 * "is_owner:project"). Existing rows are backfilled to 'global' via the
 * column default, so attributes that were previously implicitly global
 * (e.g. is_admin) keep working with no data migration needed. Any attribute
 * meant to be resource-scoped (e.g. is_owner -> 'project') should be
 * updated after this migration runs.
 *
 * Not nullable: every attribute must resolve to *some* resource scope for
 * the PDP matching logic to work, and 'global' is a safe, explicit default
 * rather than leaving it null and having callers guess.
 */

exports.up = async function up(knex) {
  const hasResourceColumn = await knex.schema.hasColumn('attributes', 'resource');
  if (!hasResourceColumn) {
    await knex.schema.alterTable('attributes', (table) => {
      table.string('resource').notNullable().defaultTo('global');
      table.index('resource', 'attributes_resource_idx');
    });
  }
};

exports.down = async function down(knex) {
  const hasResourceColumn = await knex.schema.hasColumn('attributes', 'resource');
  if (hasResourceColumn) {
    await knex.schema.alterTable('attributes', (table) => {
      table.dropIndex('resource', 'attributes_resource_idx');
      table.dropColumn('resource');
    });
  }
};