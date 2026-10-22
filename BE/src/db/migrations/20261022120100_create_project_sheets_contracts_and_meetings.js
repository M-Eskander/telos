// A project keeps its own sheet (the revenue share calculator, the roster)
// and its own contract layout. Contracts are made from the two together.
exports.up = function(knex) {
  return knex.schema
    .createTable('project_sheets', function(table) {
      table.increments('id').primary();
      table.integer('project_id').unsigned().notNullable()
        .references('id').inTable('projects').onDelete('CASCADE');
      table.string('name', 120).notNullable();
      table.integer('position').notNullable().defaultTo(0);
      table.json('data').notNullable();
      table.string('source', 32).notNullable().defaultTo('manual');
      table.string('source_name', 255).nullable();
      table.timestamps(true, true);
      table.unique(['project_id', 'name']);
    })
    .createTable('project_contract_templates', function(table) {
      table.increments('id').primary();
      table.integer('project_id').unsigned().notNullable()
        .references('id').inTable('projects').onDelete('CASCADE');
      table.string('name', 160).notNullable();
      table.text('body').notNullable();
      table.string('pdf_key', 64).nullable();
      table.string('original_name', 255).nullable();
      table.timestamps(true, true);
      table.unique(['project_id', 'name']);
    })
    .createTable('project_contracts', function(table) {
      table.increments('id').primary();
      table.integer('project_id').unsigned().notNullable()
        .references('id').inTable('projects').onDelete('CASCADE');
      table.integer('template_id').unsigned().nullable()
        .references('id').inTable('project_contract_templates').onDelete('SET NULL');
      table.integer('user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.string('person_name', 160).notNullable();
      table.json('document_data').notNullable();
      table.date('start_date').nullable();
      table.date('end_date').nullable();
      table.string('status', 24).notNullable().defaultTo('draft');
      table.integer('created_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
    })
    .createTable('project_meetings', function(table) {
      table.increments('id').primary();
      table.integer('project_id').unsigned().notNullable()
        .references('id').inTable('projects').onDelete('CASCADE');
      table.string('title', 160).notNullable();
      table.text('notes').nullable();
      table.date('start_date').notNullable();
      table.time('start_time').notNullable().defaultTo('10:00:00');
      table.integer('duration_minutes').notNullable().defaultTo(60);
      table.string('recurrence', 24).notNullable().defaultTo('once');
      table.integer('recurrence_interval').notNullable().defaultTo(1);
      table.json('weekdays').nullable();
      table.integer('monthly_day').nullable();
      table.date('until_date').nullable();
      table.integer('created_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
    })
    .createTable('project_meeting_attendees', function(table) {
      table.increments('id').primary();
      table.integer('meeting_id').unsigned().notNullable()
        .references('id').inTable('project_meetings').onDelete('CASCADE');
      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.timestamps(true, true);
      table.unique(['meeting_id', 'user_id']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('project_meeting_attendees')
    .dropTableIfExists('project_meetings')
    .dropTableIfExists('project_contracts')
    .dropTableIfExists('project_contract_templates')
    .dropTableIfExists('project_sheets');
};
