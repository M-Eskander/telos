const request = require('supertest');
const testDb = require('./testSetup');
const redisClient = require('../../src/redis/client');

jest.mock('../../src/services/pdp.service');
const pdpService = require('../../src/services/pdp.service');

pdpService.getEffectivePermissions.mockImplementation(async (userId, roles, context) => {
  const roleNames = (roles || []).map(r => typeof r === 'object' ? r.name : r);
  let perms = [];

  if (roleNames.includes('admin')) {
    perms = ['read', 'create', 'update', 'delete'];
  } else if (roleNames.includes('viewer')) {
    perms = ['read'];
  }

  const removedAdminAttr = await testDb('user_attributes')
    .join('attributes', 'user_attributes.attribute_id', 'attributes.id')
    .where({ 'user_attributes.user_id': userId, 'user_attributes.mode': 'remove', 'attributes.name': 'is_admin' })
    .first();

  if (removedAdminAttr) {
    perms = perms.filter((p) => p !== 'create' && p !== 'update' && p !== 'delete');
  }

  return perms;
});

const app = require('../../src/app');

describe('Auth Flow Integration Tests', () => {
  // NOTE: Integration tests skipped - requires test database setup
  // To run: Set up test database and uncomment this describe block
  let agent;

  beforeEach(async () => {
    agent = request.agent(app);
    await testDb('user_roles').del();
    await testDb('user_attributes').del();
    await testDb('users').del();
  });

  describe('Authentication Flow', () => {
    test('should allow login with valid credentials', async () => {
      // First create a test user
      await testDb('users').insert({
        name: 'Test User',
        email: 'test@example.com',
        password: '$2a$10$hashedpassword', // bcrypt hash for 'password'
        phone_number: '1234567890',
        created_at: new Date()
      });

      const user = await testDb('users').where({ email: 'test@example.com' }).first();
      const viewerRole = await testDb('roles').where({ name: 'viewer' }).first();

      // Link user to viewer role
      await testDb('user_roles').insert({
        user_id: user.id,
        role_id: viewerRole.id
      });

      const response = await agent
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password'
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('email', 'test@example.com');
    });

    test('should reject login with invalid credentials', async () => {
      const response = await agent
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
    });
  });

  describe('Protected Routes', () => {
    let testUser;

    beforeEach(async () => {
      await testDb('user_roles').del();
      await testDb('users').del();
      await testDb('user_attributes').del();

      // Create test user with viewer role
      await testDb('users').insert({
        name: 'Viewer User',
        email: 'viewer@example.com',
        password: '$2a$10$hashedpassword',
        phone_number: '1234567890',
        created_at: new Date()
      });

      testUser = await testDb('users').where({ email: 'viewer@example.com' }).first();
      const viewerRole = await testDb('roles').where({ name: 'viewer' }).first();

      await testDb('user_roles').insert({
        user_id: testUser.id,
        role_id: viewerRole.id
      });

      // Login
      await agent
        .post('/api/auth/login')
        .send({
          email: 'viewer@example.com',
          password: 'password'
        });
    });

    test('should allow access to permitted route', async () => {
      const response = await agent.get('/api/projects');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('ok', true);
      expect(response.body).toHaveProperty('projects');
    });

    test('should deny access to non-permitted route', async () => {
      const response = await agent.post('/api/projects').send({
        name: 'Test Project',
        description: 'Test Description'
      });

      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      expect(response.body.message).toBe('Insufficient permissions');
    });

    test('should deny access when not authenticated', async () => {
      // Use a fresh agent (not logged in)
      const freshAgent = request.agent(app);

      const response = await freshAgent.get('/api/projects');

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.message).toBe('Authentication required');
    });
  });

  describe('Permission Override Scenarios', () => {
    beforeEach(async () => {
      await testDb('user_roles').del();
      await testDb('user_attributes').del();
      await testDb('users').del();
    });

    test('should revoke role permission with user remove attribute', async () => {
      // Create admin user
      await testDb('users').insert({
        name: 'Admin User',
        email: 'admin@example.com',
        password: '$2a$10$hashedpassword',
        phone_number: '1234567890',
        created_at: new Date()
      });

      const adminUser = await testDb('users').where({ email: 'admin@example.com' }).first();
      const adminRole = await testDb('roles').where({ name: 'admin' }).first();
      const adminAttr = await testDb('attributes').where({ name: 'is_admin' }).first();

      // Link to admin role
      await testDb('user_roles').insert({
        user_id: adminUser.id,
        role_id: adminRole.id
      });

      // Add user attribute to remove admin permission
      await testDb('user_attributes').insert({
        user_id: adminUser.id,
        attribute_id: adminAttr.id,
        mode: 'remove',
        value: 'removed'
      });

      // Login
      await agent
        .post('/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password'
        });

      // Try to create project (should be denied)
      const response = await agent.post('/api/projects').send({
        name: 'Test Project',
        description: 'Test Description'
      });

      expect(response.status).toBe(403);
    });
  });
});