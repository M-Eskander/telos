exports.up = async function(knex) {
  if (await knex.schema.hasTable('project_workbooks')) return;
  await knex.schema.createTable('project_workbooks', (table) => {
    table.increments('id').primary();
    // One original workbook per project: it is the export template.
    table.integer('project_id').unsigned().notNullable().unique()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.string('file_name', 255).notNullable();
    table.string('mime_type', 120);
    table.integer('size').unsigned().notNullable();
    // SQLite has no LONGBLOB; its BLOB type is already unbounded.
    const blob = knex.client.config.client === 'sqlite3' ? 'BLOB' : 'LONGBLOB';
    table.specificType('data', blob).notNullable();
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('project_workbooks');
};
