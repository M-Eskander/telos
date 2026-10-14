exports.up = function(knex) {
  return knex.schema.createTable('contracts', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('file_url').notNullable(); // Google Drive link or uploaded file path
    table.text('terms').nullable();
    table.date('start_date').nullable();
    table.date('end_date').nullable();
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('contracts');
};