const path = require('path');
const createKnex = require('knex');
const authorizationMigration = require('../../src/db/migrations/20261018000000_add_authorization_rule_groups_and_owner_account');
const permissionsSeed = require('../../src/db/seeds/permissions_seed');
const projectTeamMigration = require('../../src/db/migrations/20261019050000_create_project_departments_and_memberships');
const contractsMigration = require('../../src/db/migrations/20261019060000_add_uploaded_user_contracts');
const passwordResetMigration = require('../../src/db/migrations/20261021000000_add_password_reset_to_users');

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
    expect(await migrationDb.schema.hasTable('project_departments')).toBe(true);
    expect(await migrationDb.schema.hasTable('project_memberships')).toBe(true);
    expect(await migrationDb.schema.hasTable('contracts')).toBe(true);
    expect(await migrationDb.schema.hasColumn('contracts', 'storage_key')).toBe(true);
    expect(await migrationDb.schema.hasColumn('users', 'password_reset_token_hash')).toBe(true);
    expect(await migrationDb.schema.hasColumn('users', 'password_reset_expires_at')).toBe(true);

    await permissionsSeed.seed(migrationDb);
    const seededPermissions = await migrationDb('permissions')
      .select('action', 'resource');
    expect(seededPermissions).toHaveLength(13);
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

    await projectTeamMigration.down(migrationDb);
    expect(await migrationDb.schema.hasTable('project_memberships')).toBe(false);
    expect(await migrationDb.schema.hasTable('project_departments')).toBe(false);
    await projectTeamMigration.up(migrationDb);
    expect(await migrationDb.schema.hasTable('project_departments')).toBe(true);
    expect(await migrationDb.schema.hasTable('project_memberships')).toBe(true);

    await contractsMigration.down(migrationDb);
    expect(await migrationDb.schema.hasColumn('contracts', 'storage_key')).toBe(false);
    const [legacyUserId] = await migrationDb('users').insert({
      name: 'Legacy Member',
      email: 'legacy-member@example.com',
      phone_number: '5550100',
      is_active: true
    });
    const [ownerId] = await migrationDb('users').insert({
      name: 'Owner',
      email: 'migration-owner@example.com',
      phone_number: '5550101',
      is_active: true
    });
    await migrationDb('owner_account').insert({ id: 1, user_id: ownerId });

    await contractsMigration.up(migrationDb);
    expect(Number((await migrationDb('users').where({ id: legacyUserId }).first()).is_active))
      .toBe(0);
    expect(Number((await migrationDb('users').where({ id: ownerId }).first()).is_active))
      .toBe(1);
    expect(await migrationDb.schema.hasColumn('contracts', 'storage_key')).toBe(true);

    await passwordResetMigration.down(migrationDb);
    expect(await migrationDb.schema.hasColumn('users', 'password_reset_token_hash')).toBe(false);
    expect(await migrationDb.schema.hasColumn('users', 'password_reset_expires_at')).toBe(false);
    await passwordResetMigration.up(migrationDb);
    expect(await migrationDb.schema.hasColumn('users', 'password_reset_token_hash')).toBe(true);
    expect(await migrationDb.schema.hasColumn('users', 'password_reset_expires_at')).toBe(true);

    const [, rolledBackMigrations] = await migrationDb.migrate.rollback(undefined, true);
    expect(rolledBackMigrations.length).toBeGreaterThan(0);
    expect(await migrationDb.schema.hasTable('permissions')).toBe(false);
    expect(await migrationDb.schema.hasTable('users')).toBe(false);
  });
});
