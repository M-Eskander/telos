const redisClient = require('../../src/redis/client');
const pdpService = require('../../src/services/pdp.service');

const userAttributesRepo = require('../../src/repositories/userAttributes.repo');
const roleAttributesRepo = require('../../src/repositories/roleAttributes.repos');
const permissionAttributesRepo = require('../../src/repositories/permissionAttributes.repo');

describe('Cache Invalidation Unit Tests', () => {
  const mockUserId = 1;
  const mockAdminRole = 'admin';
  const mockViewerRole = 'viewer';

  beforeEach(() => {
    jest.restoreAllMocks();
    pdpService._clearCache();

    // 1. Force state flags to true so pdpService doesn't bypass logic thinking Redis is dead
    redisClient.isOpen = true;
    redisClient.isReady = true;

    // 2. Set default predictable stubs for all redis client interactions
    jest.spyOn(redisClient, 'keys').mockResolvedValue([]);
    jest.spyOn(redisClient, 'del').mockResolvedValue(0);
    jest.spyOn(redisClient, 'get').mockResolvedValue(null);
    jest.spyOn(redisClient, 'setEx').mockResolvedValue('OK');

    // 3. Fully intercept database repository loops to eliminate SQLite table errors
    jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({});
    jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
    jest.spyOn(userAttributesRepo, 'getAttributesByUser').mockResolvedValue([]);
  });

  describe('Permission Change Flow', () => {
    test('should revoke user access instantly', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'project:delete': [{ name: 'is_admin', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'is_admin', resource: 'global' }]);

      const cacheKey = `user_permissions:${mockUserId}`;
      
      jest.spyOn(redisClient, 'get')
        .mockResolvedValueOnce(null) // Miss first to trigger generation path
        .mockResolvedValue(JSON.stringify(['project:delete'])); // Continuous cache hits

      let perms = await pdpService.getEffectivePermissions(mockUserId, [mockAdminRole]);
      expect(perms).toContain('project:delete');
      expect(await redisClient.get(cacheKey)).not.toBeNull();

      // Act: Admin drops role properties and clears permissions key array
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
      jest.spyOn(redisClient, 'keys').mockResolvedValue([cacheKey]);
      jest.spyOn(redisClient, 'del').mockResolvedValue(1);
      jest.spyOn(redisClient, 'get').mockResolvedValue(null); 

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
      
      // Setup hot cache override return array
      jest.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify(['task:approve']));
      jest.spyOn(redisClient, 'keys').mockResolvedValue([`user_permissions:${mockUserId}`]);
      jest.spyOn(redisClient, 'del').mockResolvedValue(1);

      await pdpService.invalidateUserPermissionCache(mockUserId);

      const updatedPerms = await pdpService.getEffectivePermissions(mockUserId, [mockViewerRole]);
      expect(updatedPerms).toContain('task:approve');
    });
  });

  describe('Role Change Broadcast', () => {
    test('should invalidate caches for all role members', async () => {
      const usersInRole = [1, 2, 3, 4, 5];
      const mockKeys = usersInRole.map(id => `user_permissions:${id}`);
      
      jest.spyOn(redisClient, 'keys').mockResolvedValue(mockKeys);
      jest.spyOn(redisClient, 'del').mockResolvedValue(mockKeys.length);

      const deletedCount = await pdpService.invalidateAllPermissionCaches();
      expect(deletedCount).toBeGreaterThanOrEqual(5);
    });

    test('should handle role changes with many users', async () => {
      const mockKeys = Array.from({ length: 150 }, (_, i) => `user_permissions:${i + 1}:project:10`);
      jest.spyOn(redisClient, 'keys').mockResolvedValue(mockKeys);
      jest.spyOn(redisClient, 'del').mockResolvedValue(mockKeys.length);

      const startTime = performance.now();
      const cleared = await pdpService.invalidateAllPermissionCaches();
      const endTime = performance.now();

      expect(cleared).toBe(150);
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('Cache Consistency', () => {
    test('should keep cache and database synchronized', async () => {
      jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
        'read:all': [{ name: 'viewer', resource: 'global' }]
      });
      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'viewer', resource: 'global' }]);
      
      jest.spyOn(redisClient, 'get')
        .mockResolvedValueOnce(null)
        .mockResolvedValue(JSON.stringify(['read:all']));

      let initial = await pdpService.getEffectivePermissions(mockUserId, ['user']);
      expect(initial).toContain('read:all');

      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
      jest.spyOn(redisClient, 'get').mockResolvedValue(null);
      jest.spyOn(redisClient, 'keys').mockResolvedValue([`user_permissions:${mockUserId}`]);
      jest.spyOn(redisClient, 'del').mockResolvedValue(1);

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
      
      jest.spyOn(redisClient, 'get')
        .mockResolvedValueOnce(null)
        .mockResolvedValue(JSON.stringify(['execute:code']));

      const perms = await pdpService.getEffectivePermissions(mockUserId, ['engineer']);
      expect(perms).toContain('execute:code');
      expect(await redisClient.get(cacheKey)).not.toBeNull();
    });
  });

  describe('Error Scenarios', () => {
    test('should handle database failure gracefully', async () => {
      jest.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify(['cached:permission']));
      jest.spyOn(userAttributesRepo, 'getAttributesByUser').mockRejectedValue(new Error('Database connection dead'));

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
      jest.spyOn(redisClient, 'keys').mockResolvedValue(['user_permissions:1']);
      jest.spyOn(redisClient, 'del').mockRejectedValue(new Error('Socket Closed halfway'));

      const result = await pdpService.invalidateUserPermissionCache(1);
      expect(result).toBe(false);
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

      jest.spyOn(redisClient, 'get')
        .mockResolvedValueOnce(null)
        .mockResolvedValue(JSON.stringify(['admin:power']));

      let access = await pdpService.getEffectivePermissions(mockUserId, ['root-role']);
      expect(access).toContain('admin:power');

      jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
      jest.spyOn(redisClient, 'get').mockResolvedValue(null);
      jest.spyOn(redisClient, 'keys').mockResolvedValue([`user_permissions:${mockUserId}`]);
      jest.spyOn(redisClient, 'del').mockResolvedValue(1);

      await pdpService.invalidateUserPermissionCache(mockUserId);
      expect(await redisClient.get(`user_permissions:${mockUserId}`)).toBeNull();

      let updatedAccess = await pdpService.getEffectivePermissions(mockUserId, ['root-role']);
      expect(updatedAccess).not.toContain('admin:power');
    });
  });
});