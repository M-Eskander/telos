// FORCE LOCAL PORT AND CLEAR PASSWORD AT THE ABSOLUTE TOP
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.REDIS_PASSWORD = ''; // Clear the password for the test environment


const request = require('supertest');
const app = require('../../src/app');
const redisClient = require('../../src/redis/client');
const pdpService = require('../../src/services/pdp.service');

// Import repos to spy on database communication behavior
const userAttributesRepo = require('../../src/repositories/userAttributes.repo');
const roleAttributesRepo = require('../../src/repositories/roleAttributes.repos');
const permissionAttributesRepo = require('../../src/repositories/permissionAttributes.repo');

describe('Cache Invalidation Integration Tests', () => {
  let authCookie;
  const mockUserId = 1;
  const mockAdminRole = 'admin';
  const mockViewerRole = 'viewer';

  beforeAll(async () => {
    if (!redisClient.isOpen && !redisClient.isReady) {
      await redisClient.connect();
    }
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    pdpService._clearCache();

    // Fallback global spy safeguards to capture unhandled cache misses and prevent SQLite missing table crashes
    jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({});
    jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
    jest.spyOn(userAttributesRepo, 'getAttributesByUser').mockResolvedValue([]);

    // Safely clear keys if connected
    if (redisClient.isOpen && redisClient.isReady) {
      try {
        const keys = await redisClient.keys('user_permissions:*');
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } catch (err) {
        // Suppress initial hook failures
      }
    }

    authCookie = ['connect.sid=mock_integration_test_session_id'];
  });

  afterAll(async () => {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  describe('Permission Change Flow', () => {
    test('should revoke user access instantly', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'project:delete': [{ name: 'is_admin', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'is_admin', resource: 'global' }]);

      const cacheKey = `user_permissions:${mockUserId}`;

      let perms = await pdpService.getEffectivePermissions(mockUserId, [mockAdminRole]);
      expect(perms).toContain('project:delete');
      
      const cachedVal = await redisClient.get(cacheKey);
      expect(cachedVal).not.toBeNull();
      expect(cachedVal).not.toBeUndefined();

      // Act: Emulate structural change removing permissions profile
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]); 
      await pdpService.invalidateUserPermissionCache(mockUserId);

      expect(await redisClient.get(cacheKey)).toBeNull();
      
      const updatedPerms = await pdpService.getEffectivePermissions(mockUserId, [mockAdminRole]);
      expect(updatedPerms).not.toContain('project:delete');
    });

    test('should grant user access instantly', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'task:approve': [{ name: 'can_approve', resource: 'task' }]
      });

      let perms = await pdpService.getEffectivePermissions(mockUserId, [mockViewerRole]);
      expect(perms).not.toContain('task:approve');

      jest.spyOn(userAttributesRepo, 'getAttributesByUser').mockResolvedValue([{ name: 'can_approve', resource: 'task', mode: 'add' }]);
      await pdpService.invalidateUserPermissionCache(mockUserId);

      const updatedPerms = await pdpService.getEffectivePermissions(mockUserId, [mockViewerRole]);
      expect(updatedPerms).toContain('task:approve');
    });
  });

  describe('Role Change Broadcast', () => {
    test('should invalidate caches for all role members', async () => {
      const usersInRole = [1, 2, 3, 4, 5];
      
      for (const id of usersInRole) {
        await redisClient.setEx(`user_permissions:${id}`, 300, JSON.stringify(['project:read']));
      }

      const deletedCount = await pdpService.invalidateAllPermissionCaches();
      expect(deletedCount).toBeGreaterThanOrEqual(5);

      for (const id of usersInRole) {
        expect(await redisClient.get(`user_permissions:${id}`)).toBeNull();
      }
    });

    test('should handle role changes with many users', async () => {
      const totalKeys = 150;
      for (let i = 1; i <= totalKeys; i++) {
        await redisClient.setEx(`user_permissions:${i}:project:10`, 300, JSON.stringify(['view']));
      }

      const startTime = performance.now();
      const cleared = await pdpService.invalidateAllPermissionCaches();
      const endTime = performance.now();

      expect(cleared).toBeGreaterThanOrEqual(totalKeys);
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('Cache Consistency', () => {
    test('should keep cache and database synchronized', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'read:all': [{ name: 'viewer', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'viewer', resource: 'global' }]);

      let initial = await pdpService.getEffectivePermissions(mockUserId, ['user']);
      expect(initial).toContain('read:all');

      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
      await pdpService.invalidateUserPermissionCache(mockUserId);

      let finalCheck = await pdpService.getEffectivePermissions(mockUserId, ['user']);
      expect(finalCheck).not.toContain('read:all');
    });

    test('should handle cache miss gracefully', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'execute:code': [{ name: 'dev', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'dev', resource: 'global' }]);

      const cacheKey = `user_permissions:${mockUserId}`;
      await redisClient.del(cacheKey);

      const perms = await pdpService.getEffectivePermissions(mockUserId, ['engineer']);
      expect(perms).toContain('execute:code');
      
      const cachedVal = await redisClient.get(cacheKey);
      expect(cachedVal).not.toBeNull();
      expect(cachedVal).not.toBeUndefined();
    });
  });

  describe('Error Scenarios', () => {
    test('should handle database failure gracefully', async () => {
      // Setup the allowed mapping so the initial build can populate properly
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'cached:permission': [{ name: 'user', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'user', resource: 'global' }]);

      // 1. Completely warm up the real Redis footprint using production code pathways
      await pdpService.getEffectivePermissions(mockUserId, ['user']);

      // 2. Kill the database queries safely
      jest.spyOn(userAttributesRepo, 'getAttributesByUser').mockRejectedValue(new Error('Database connection dead'));
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockRejectedValue(new Error('Database connection dead'));
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockRejectedValue(new Error('Database connection dead'));

      // 3. System handles gracefully by loading straight out of warmed cache
      const perms = await pdpService.getEffectivePermissions(mockUserId, ['user']);
      expect(perms).toContain('cached:permission');
    });

    test('should handle Redis failure gracefully', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'read:all': [{ name: 'user', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'user', resource: 'global' }]);

      const getSpy = jest.spyOn(redisClient, 'get').mockRejectedValue(new Error('Redis connection lost'));
      const setExSpy = jest.spyOn(redisClient, 'setEx').mockRejectedValue(new Error('Redis connection lost'));

      const perms = await pdpService.getEffectivePermissions(mockUserId, ['user']);
      expect(perms).toContain('read:all');

      getSpy.mockRestore();
      setExSpy.mockRestore();
    });

    test('should handle partial failure', async () => {
      await redisClient.setEx(`user_permissions:1`, 300, JSON.stringify(['read']));
      await redisClient.setEx(`user_permissions:1:project:5`, 300, JSON.stringify(['write']));

      const delSpy = jest.spyOn(redisClient, 'del').mockRejectedValueOnce(new Error('Socket Closed halfway'));

      const result = await pdpService.invalidateUserPermissionCache(1);
      expect(result).toBe(false);

      delSpy.mockRestore();
    });
  });

  describe('Performance Benchmarks', () => {
    test('user attribute change should be <50ms', async () => {
      const start = performance.now();
      await pdpService.invalidateUserPermissionCache(mockUserId);
      const end = performance.now();
      expect(end - start).toBeLessThan(50);
    });

    test('role attribute change should be <200ms', async () => {
      const start = performance.now();
      await pdpService.invalidateAllPermissionCaches();
      const end = performance.now();
      expect(end - start).toBeLessThan(200);
    });

    test('cache rebuild should be <100ms per user', async () => {
      const start = performance.now();
      await pdpService.getEffectivePermissions(mockUserId, ['user']);
      const end = performance.now();
      expect(end - start).toBeLessThan(100);
    });
  });

  describe('Verification Checklist Tests', () => {
    test('CHECKLIST: Full security circuit execution validation', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'admin:power': [{ name: 'root', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'root', resource: 'global' }]);

      let access = await pdpService.getEffectivePermissions(mockUserId, ['root-role']);
      expect(access).toContain('admin:power');

      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
      await pdpService.invalidateUserPermissionCache(mockUserId);
      
      const res = await redisClient.get(`user_permissions:${mockUserId}`);
      expect(res).toBeNull();

      let updatedAccess = await pdpService.getEffectivePermissions(mockUserId, ['root-role']);
      expect(updatedAccess).not.toContain('admin:power');
    });
  });
});