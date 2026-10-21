// Task ordering, milestones and the fields the schedule views need.
//
// `position` gives siblings a deliberate order (the list and the timeline both
// read it). `is_milestone` marks a zero-length date task that the timeline
// draws as a diamond instead of a bar. `updated_at` lets the app tell how
// long a task has been sitting still.
exports.up = async function(knex) {
  const hasPosition = await knex.schema.hasColumn('tasks', 'position');
  const hasMilestone = await knex.schema.hasColumn('tasks', 'is_milestone');
  const hasUpdatedAt = await knex.schema.hasColumn('tasks', 'updated_at');

  await knex.schema.alterTable('tasks', function(table) {
    if (!hasPosition) table.integer('position').notNullable().defaultTo(0);
    if (!hasMilestone) table.boolean('is_milestone').notNullable().defaultTo(false);
    if (!hasUpdatedAt) table.timestamp('updated_at').nullable();
  });

  // Give the existing tasks a stable order within their family.
  const tasks = await knex('tasks').select('id', 'project_id', 'parent_task_id').orderBy('id');
  const counters = new Map();
  for (const task of tasks) {
    const key = `${task.project_id}:${task.parent_task_id || 'root'}`;
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    await knex('tasks').where({ id: task.id }).update({ position: next });
  }

  await knex('tasks').whereNull('updated_at').update({ updated_at: knex.ref('created_at') });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('position');
    table.dropColumn('is_milestone');
    table.dropColumn('updated_at');
  });
};
