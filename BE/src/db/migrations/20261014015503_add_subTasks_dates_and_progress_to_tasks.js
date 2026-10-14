exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.integer('parent_task_id').unsigned().references('id').inTable('tasks').onDelete('CASCADE').nullable(); // For subtasks[cite: 2]
    table.integer('progress').defaultTo(0); // 0 to 100%[cite: 2]
    table.date('start_date').nullable();
    table.date('end_date').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('parent_task_id');
    table.dropColumn('progress');
    table.dropColumn('start_date');
    table.dropColumn('end_date');
  });
};