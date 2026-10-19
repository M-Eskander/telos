exports.up = async function(knex) {
  const hasName = await knex.schema.hasColumn('permissions', 'name');
  const hasAction = await knex.schema.hasColumn('permissions', 'action');

  await knex.schema.alterTable('permissions', (table) => {
    // Rename name → action (only if needed)
    if (hasName && !hasAction) {
      table.renameColumn('name', 'action');
    }
  });

  const hasResource = await knex.schema.hasColumn('permissions', 'resource');

  await knex.schema.alterTable('permissions', (table) => {
    // Add resource if it doesn't exist
    if (!hasResource) {
      table.string('resource', 50).notNullable().defaultTo('general');
    }



  });

  // Add unique constraint safely
  try {
    await knex.schema.alterTable('permissions', (table) => {
      table.unique(['action', 'resource']);
    });
  } catch (err) {
    // ignore if already exists
  }
};

exports.down = async function(knex) {
  if (!(await knex.schema.hasTable('permissions'))) {
    return;
  }

  const hasAction = await knex.schema.hasColumn('permissions', 'action');
  const hasResource = await knex.schema.hasColumn('permissions', 'resource');
  if (!hasAction || !hasResource) {
    return;
  }

  await knex.schema.alterTable('permissions', (table) => {
    table.dropUnique(['action', 'resource']);
    table.dropColumn('resource');
    table.renameColumn('action', 'name');
  });
};