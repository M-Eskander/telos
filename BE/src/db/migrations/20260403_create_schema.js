exports.up = async function(knex) {
  if (!(await knex.schema.hasTable('games'))) {
    await knex.schema.createTable('games', (table) => {
      table.increments('id').primary();
      table.string('title');
      table.string('cover_image');
      table.decimal('price', 10, 2);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('teams'))) {
    await knex.schema.createTable('teams', (table) => {
      table.increments('id').primary();
      table.string('name');
    });
  }

  if (!(await knex.schema.hasTable('roles'))) {
    await knex.schema.createTable('roles', (table) => {
      table.increments('id').primary();
      table.string('name');
    });
  }

  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('phone_number').notNullable();
      table.string('email').unique();
      table.string('password');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('permissions'))) {
    await knex.schema.createTable('permissions', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
    });
  }

  if (!(await knex.schema.hasTable('status'))) {
    await knex.schema.createTable('status', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
    });
  }

  if (!(await knex.schema.hasTable('projects'))) {
    await knex.schema.createTable('projects', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('description');
      table.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('tasks'))) {
    await knex.schema.createTable('tasks', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.text('description');
      table.integer('status').unsigned().references('id').inTable('status').onDelete('SET NULL');
      table.string('priority');
      table.integer('project_id').unsigned().references('id').inTable('projects').onDelete('CASCADE');
      table.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('game_teams'))) {
    await knex.schema.createTable('game_teams', (table) => {
      table.integer('game_id').unsigned().notNullable().references('id').inTable('games').onDelete('CASCADE');
      table.integer('team_id').unsigned().notNullable().references('id').inTable('teams').onDelete('CASCADE');
      table.primary(['game_id','team_id']);
    });
  }

  if (!(await knex.schema.hasTable('user_roles'))) {
    await knex.schema.createTable('user_roles', (table) => {
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
      table.primary(['role_id','user_id']);
    });
  }

  if (!(await knex.schema.hasTable('role_permissions'))) {
    await knex.schema.createTable('role_permissions', (table) => {
      table.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
      table.integer('permission_id').unsigned().notNullable().references('id').inTable('permissions').onDelete('CASCADE');
      table.primary(['permission_id','role_id']);
    });
  }

  if (!(await knex.schema.hasTable('task_assignment'))) {
    await knex.schema.createTable('task_assignment', (table) => {
      table.integer('task_id').unsigned().notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.primary(['task_id','user_id']);
    });
  }

  if (!(await knex.schema.hasTable('task_attachments'))) {
    await knex.schema.createTable('task_attachments', (table) => {
      table.increments('id').primary();
      table.integer('task_id').unsigned().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('file_url').notNullable();
      table.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }

  if (!(await knex.schema.hasTable('task_dependencies'))) {
    await knex.schema.createTable('task_dependencies', (table) => {
      table.integer('task_id').unsigned().notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.integer('depends_on_id').unsigned().notNullable().references('id').inTable('tasks').onDelete('CASCADE');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('task_dependencies');
  await knex.schema.dropTableIfExists('task_attachments');
  await knex.schema.dropTableIfExists('task_assignment');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('game_teams');
  await knex.schema.dropTableIfExists('tasks');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('status');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('teams');
  await knex.schema.dropTableIfExists('games');
};
