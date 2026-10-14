exports.up = async function(knex) {
  // 1. Drop the foreign key constraint first
  await knex.schema.alterTable('tasks', function(table) {
    table.dropForeign('status'); // or table.dropForeign([], 'tasks_status_foreign') if needed
  }).catch(() => {
    // Fallback in case constraint name differs or is already gone
  });

  // Alternatively, if knex dropForeign gives trouble, you can run a raw query:
  // await knex.raw('ALTER TABLE tasks DROP FOREIGN KEY tasks_status_foreign');

  // 2. Drop the status column
  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('status');
  });

  // 3. Re-add status as a simple string column
  await knex.schema.alterTable('tasks', function(table) {
    table.string('status').defaultTo('todo');
  });

  // 4. Drop the status table entirely
  await knex.schema.dropTableIfExists('status');
};

exports.down = async function(knex) {
  await knex.schema.createTable('status', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('status');
    table.integer('status_id').unsigned().references('id').inTable('status').onDelete('SET NULL');
  });
};