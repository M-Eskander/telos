// Cross-database helpers. MySQL refuses to drop an index that backs a foreign
// key, so every index replacement below adds the new index before dropping the
// old one, and every step is guarded so the migration can be re-run after a
// partial failure (e.g. a previous attempt already added a column).
async function hasIndex(knex, table, indexName) {
  const client = knex.client && knex.client.config && knex.client.config.client;
  if (client === 'sqlite3' || client === 'better-sqlite3') {
    const rows = await knex.raw(`PRAGMA index_list("${table}")`);
    return Array.isArray(rows) && rows.some((row) => row.name === indexName);
  }
  const result = await knex.raw(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
    [table, indexName]
  );
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(rows) && rows.length > 0;
}

async function hasPrimaryKey(knex, table) {
  const client = knex.client && knex.client.config && knex.client.config.client;
  if (client === 'sqlite3' || client === 'better-sqlite3') {
    const rows = await knex.raw(`PRAGMA table_info("${table}")`);
    return Array.isArray(rows) && rows.some((row) => Number(row.pk) > 0);
  }
  const result = await knex.raw(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = 'PRIMARY' LIMIT 1",
    [table]
  );
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(rows) && rows.length > 0;
}

async function addUniqueIfMissing(knex, table, indexName, columns) {
  if (await hasIndex(knex, table, indexName)) return;
  await knex.schema.alterTable(table, (t) => {
    t.unique(columns, { indexName });
  });
}

async function dropUniqueIfExists(knex, table, indexName, columns) {
  if (!(await hasIndex(knex, table, indexName))) return;
  await knex.schema.alterTable(table, (t) => {
    t.dropUnique(columns, indexName);
  });
}

exports.up = async function(knex) {
  // permission_attributes ---------------------------------------------------
  if (!(await knex.schema.hasColumn('permission_attributes', 'grant_group'))) {
    await knex.schema.alterTable('permission_attributes', (table) => {
      table.integer('grant_group').notNullable().defaultTo(0);
    });
  }

  // The old (permission_id, attribute_id) index is what backs the
  // permission_id foreign key on MySQL, so the replacement unique index has
  // to exist before the old one can be dropped.
  await addUniqueIfMissing(knex, 'permission_attributes',
    'permission_attributes_perm_group_attr_unique',
    ['permission_id', 'grant_group', 'attribute_id']);
  await dropUniqueIfExists(knex, 'permission_attributes',
    'permission_attributes_permission_id_attribute_id_unique',
    ['permission_id', 'attribute_id']);

  // role_attributes / user_attributes ---------------------------------------
  await addUniqueIfMissing(knex, 'role_attributes',
    'role_attributes_role_attr_resource_unique',
    ['role_id', 'attribute_id', 'resource_id']);
  await dropUniqueIfExists(knex, 'role_attributes',
    'role_attributes_role_id_attribute_id_unique',
    ['role_id', 'attribute_id']);

  await addUniqueIfMissing(knex, 'user_attributes',
    'user_attributes_user_attr_resource_unique',
    ['user_id', 'attribute_id', 'resource_id']);
  await dropUniqueIfExists(knex, 'user_attributes',
    'user_attributes_user_id_attribute_id_unique',
    ['user_id', 'attribute_id']);

  // user_roles ---------------------------------------------------------------
  if (!(await knex.schema.hasColumn('user_roles', 'resource_type'))) {
    await knex.schema.alterTable('user_roles', (table) => {
      table.string('resource_type').nullable();
    });
  }
  if (!(await knex.schema.hasColumn('user_roles', 'resource_id'))) {
    await knex.schema.alterTable('user_roles', (table) => {
      table.integer('resource_id').unsigned().nullable();
    });
  }
  if (!(await knex.schema.hasColumn('user_roles', 'scope_key'))) {
    await knex.schema.alterTable('user_roles', (table) => {
      table.string('scope_key', 100).notNullable().defaultTo('');
    });
  }
  await addUniqueIfMissing(knex, 'user_roles',
    'user_roles_user_role_scope_unique',
    ['user_id', 'role_id', 'scope_key']);
  // The new unique index does not lead with role_id, so the role_id foreign
  // key needs its own index before the primary key that currently backs it can
  // be dropped.
  if (!(await hasIndex(knex, 'user_roles', 'user_roles_role_id_index'))) {
    await knex.schema.alterTable('user_roles', (table) => {
      table.index('role_id', 'user_roles_role_id_index');
    });
  }
  if (await hasPrimaryKey(knex, 'user_roles')) {
    await knex.schema.alterTable('user_roles', (table) => {
      table.dropPrimary();
    });
  }

  // permission_grant_groups --------------------------------------------------
  if (!(await knex.schema.hasTable('permission_grant_groups'))) {
    await knex.schema.createTable('permission_grant_groups', (table) => {
      table.increments('id').primary();
      table.integer('permission_id').unsigned().notNullable()
        .references('id').inTable('permissions').onDelete('CASCADE');
      table.integer('grant_group').notNullable();
      table.unique(['permission_id', 'grant_group']);
    });
    const existingGroups = await knex('permission_attributes')
      .distinct('permission_id', 'grant_group');
    if (existingGroups.length) {
      await knex('permission_grant_groups').insert(existingGroups);
    }
  }

  // owner_account ------------------------------------------------------------
  if (!(await knex.schema.hasTable('owner_account'))) {
    await knex.schema.createTable('owner_account', (table) => {
      table.integer('id').primary();
      table.integer('user_id').unsigned().notNullable().unique()
        .references('id').inTable('users').onDelete('CASCADE');
      table.timestamps(true, true);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('owner_account');
  await knex.schema.dropTableIfExists('permission_grant_groups');

  // user_attributes / role_attributes: restore the previous unique indexes
  // before removing the resource-scoped ones (same foreign key reasoning).
  await addUniqueIfMissing(knex, 'user_attributes',
    'user_attributes_user_id_attribute_id_unique',
    ['user_id', 'attribute_id']);
  await dropUniqueIfExists(knex, 'user_attributes',
    'user_attributes_user_attr_resource_unique',
    ['user_id', 'attribute_id', 'resource_id']);

  await addUniqueIfMissing(knex, 'role_attributes',
    'role_attributes_role_id_attribute_id_unique',
    ['role_id', 'attribute_id']);
  await dropUniqueIfExists(knex, 'role_attributes',
    'role_attributes_role_attr_resource_unique',
    ['role_id', 'attribute_id', 'resource_id']);

  // user_roles ---------------------------------------------------------------
  if (await knex.schema.hasColumn('user_roles', 'resource_type')) {
    await knex('user_roles').whereNotNull('resource_type').del();
  }
  await dropUniqueIfExists(knex, 'user_roles',
    'user_roles_user_role_scope_unique',
    ['user_id', 'role_id', 'scope_key']);
  for (const column of ['scope_key', 'resource_id', 'resource_type']) {
    if (await knex.schema.hasColumn('user_roles', column)) {
      await knex.schema.alterTable('user_roles', (table) => {
        table.dropColumn(column);
      });
    }
  }
  if (!(await hasPrimaryKey(knex, 'user_roles'))) {
    await knex.schema.alterTable('user_roles', (table) => {
      table.primary(['role_id', 'user_id']);
    });
  }

  // permission_attributes ----------------------------------------------------
  await addUniqueIfMissing(knex, 'permission_attributes',
    'permission_attributes_permission_id_attribute_id_unique',
    ['permission_id', 'attribute_id']);
  await dropUniqueIfExists(knex, 'permission_attributes',
    'permission_attributes_perm_group_attr_unique',
    ['permission_id', 'grant_group', 'attribute_id']);
  if (await knex.schema.hasColumn('permission_attributes', 'grant_group')) {
    await knex.schema.alterTable('permission_attributes', (table) => {
      table.dropColumn('grant_group');
    });
  }
};
