const fs = require('fs');
const path = require('path');
const knex = require('knex');
const knexConfig = require('../../knexfile');

const testDbFile = path.resolve(__dirname, '../../test.sqlite3');
if (fs.existsSync(testDbFile)) {
  fs.unlinkSync(testDbFile);
}

// Use the shared test database config so the app and tests operate on the same SQLite file.
const testConfig = knexConfig.test;
const testDb = knex(testConfig);

beforeAll(async () => {
  // Run migrations
  await testDb.migrate.latest();

  // Seed basic data
  await testDb('attributes').insert([
    { name: 'is_admin', description: 'Administrator access' },
    { name: 'is_viewer', description: 'Can view resources' },
    { name: 'is_owner', description: 'Resource owner' }
  ]);

  await testDb('roles').insert([
    { name: 'admin' },
    { name: 'viewer' },
    { name: 'user' }
  ]);

  await testDb('permissions').insert([
    { action: 'read', resource: 'project' },
    { action: 'create', resource: 'project' },
    { action: 'delete', resource: 'project' }
  ]);

  // Link permissions to attributes
  const adminAttr = await testDb('attributes').where({ name: 'is_admin' }).first();
  const viewerAttr = await testDb('attributes').where({ name: 'is_viewer' }).first();
  const ownerAttr = await testDb('attributes').where({ name: 'is_owner' }).first();

  const readPerm = await testDb('permissions').where({ action: 'read', resource: 'project' }).first();
  const createPerm = await testDb('permissions').where({ action: 'create', resource: 'project' }).first();
  const deletePerm = await testDb('permissions').where({ action: 'delete', resource: 'project' }).first();

  await testDb('permission_attributes').insert([
    { permission_id: readPerm.id, attribute_id: viewerAttr.id },
    { permission_id: createPerm.id, attribute_id: adminAttr.id },
    { permission_id: deletePerm.id, attribute_id: adminAttr.id },
    { permission_id: deletePerm.id, attribute_id: ownerAttr.id }
  ]);

  // Link roles to attributes
  const adminRole = await testDb('roles').where({ name: 'admin' }).first();
  const viewerRole = await testDb('roles').where({ name: 'viewer' }).first();

  await testDb('role_attributes').insert([
    { role_id: adminRole.id, attribute_id: adminAttr.id, value: 'true' },
    { role_id: viewerRole.id, attribute_id: viewerAttr.id, value: 'true' }
  ]);
});

afterAll(async () => {
  await testDb.destroy();
});

module.exports = testDb;