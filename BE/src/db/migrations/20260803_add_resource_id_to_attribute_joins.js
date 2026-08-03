/**
 * Adds a nullable `resource_id` column to role_attributes and user_attributes.
 *
 * v1 scope: schema only. Both columns are nullable and unused by application
 * logic today — existing type-level / global grants (role_attributes.resource,
 * user_attributes.resource) keep working exactly as before, since a NULL
 * resource_id means "applies to the whole resource type", not a single
 * instance.
 *
 * This lays the groundwork for instance-level grants (e.g. "user X may edit
 * task #42 specifically"), which will be layered on in a later migration/PR
 * once the repos and pdp.service.js matching logic are updated to actually
 * read and use resource_id.
 */

exports.up = async function up(knex) {
  const hasRoleAttrResourceId = await knex.schema.hasColumn('role_attributes', 'resource_id');
  if (!hasRoleAttrResourceId) {
    await knex.schema.alterTable('role_attributes', (table) => {
      table.integer('resource_id').nullable();
      // Speeds up lookups once instance-scoped grants start being queried,
      // e.g. WHERE role_id = ? AND attribute_id = ? AND resource_id IN (?, NULL)
      table.index(['attribute_id', 'resource_id'], 'role_attributes_attribute_resource_idx');
    });
  }

  const hasUserAttrResourceId = await knex.schema.hasColumn('user_attributes', 'resource_id');
  if (!hasUserAttrResourceId) {
    await knex.schema.alterTable('user_attributes', (table) => {
      table.integer('resource_id').nullable();
      table.index(['attribute_id', 'resource_id'], 'user_attributes_attribute_resource_idx');
    });
  }
};

exports.down = async function down(knex) {
  const hasRoleAttrResourceId = await knex.schema.hasColumn('role_attributes', 'resource_id');
  if (hasRoleAttrResourceId) {
    await knex.schema.alterTable('role_attributes', (table) => {
      table.dropIndex(['attribute_id', 'resource_id'], 'role_attributes_attribute_resource_idx');
      table.dropColumn('resource_id');
    });
  }

  const hasUserAttrResourceId = await knex.schema.hasColumn('user_attributes', 'resource_id');
  if (hasUserAttrResourceId) {
    await knex.schema.alterTable('user_attributes', (table) => {
      table.dropIndex(['attribute_id', 'resource_id'], 'user_attributes_attribute_resource_idx');
      table.dropColumn('resource_id');
    });
  }
};