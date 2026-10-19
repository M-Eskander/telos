const path = require('path');
const createKnex = require('knex');
const authorizationMigration = require('../../src/db/migrations/20261018000000_add_authorization_rule_groups_and_owner_account');
const permissionsSeed = require('../../src/db/seeds/permissions_seed');

describe('Database migration lifecycle', () => {
  let migrationDb;

  beforeAll(() => {
    migrationDb = createKnex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      migrations: {
        directory: path.resolve(__dirname, '../../src/db/migrations')
      }
    });
  });

  afterAll(async () => {
    if (migrationDb) await migrationDb.destroy();
  });

  test('applies all migrations and can reverse and reapply the authorization schema', async () => {
    const [latestBatch, appliedMigrations] = await migrationDb.migrate.latest();
    expect(latestBatch).toBe(1);
    expect(appliedMigrations.length).toBeGreaterThan(0);
    expect(await migrationDb.schema.hasTable('users')).toBe(true);
    expect(await migrationDb.schema.hasTable('owner_account')).toBe(true);
    expect(await migrationDb.schema.hasTable('permission_grant_groups')).toBe(true);

    await permissionsSeed.seed(migrationDb);
    const seededPermissions = await migrationDb('permissions')
      .select('action', 'resource');
    expect(seededPermissions).toHaveLength(9);
    expect(seededPermissions).toEqual(expect.arrayContaining([
      { action: 'read', resource: 'project' },
      { action: 'create', resource: 'task' },
      { action: 'assign', resource: 'task' }
    ]));

    await authorizationMigration.down(migrationDb);
    expect(await migrationDb.schema.hasTable('owner_account')).toBe(false);
    expect(await migrationDb.schema.hasTable('permission_grant_groups')).toBe(false);
    expect(await migrationDb.schema.hasColumn('user_roles', 'scope_key')).toBe(false);

    await authorizationMigration.up(migrationDb);
    expect(await migrationDb.schema.hasTable('owner_account')).toBe(true);
    expect(await migrationDb.schema.hasTable('permission_grant_groups')).toBe(true);
    expect(await migrationDb.schema.hasColumn('user_roles', 'scope_key')).toBe(true);
  });
});
