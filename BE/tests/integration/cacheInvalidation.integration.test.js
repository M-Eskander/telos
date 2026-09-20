// Tests intentionally validate the current contract: Redis is optional and permission
// keys use canonical action:resource naming. They are written to match the
// graceful-degradation behavior implemented in the PDP, not the legacy mandatory-cache model.

const redisClient = require('../../src/redis/client');
const pdpService = require('../../src/services/pdp.service');
const userAttributesRepo = require('../../src/repositories/userAttributes.repo');
const roleAttributesRepo = require('../../src/repositories/roleAttributes.repos');
const permissionAttributesRepo = require('../../src/repositories/permissionAttributes.repo');

describe('Cache Invalidation Integration Tests', () => {
  const mockUserId = 1;
  const mockAdminRole = 'admin';
  const mockViewerRole = 'viewer';

  beforeEach(() => {
    jest.restoreAllMocks();
    pdpService._clearCache();

    redisClient.isOpen = true;
    redisClient.isReady = true;
    jest.spyOn(redisClient, 'keys').mockResolvedValue([]);
    jest.spyOn(redisClient, 'del').mockResolvedValue(0);
    jest.spyOn(redisClient, 'get').mockResolvedValue(null);
    jest.spyOn(redisClient, 'setEx').mockResolvedValue('OK');
    redisClient.keys.mockClear();
    redisClient.del.mockClear();
    redisClient.get.mockClear();
    redisClient.setEx.mockClear();

    jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({});
    jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([]);
    jest.spyOn(userAttributesRepo, 'getAttributesByUser').mockResolvedValue([]);
  });

  test('should compute permissions and cache them when Redis is connected', async () => {
    jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
      'project:delete': [{ name: 'is_admin', resource: 'global' }]
    });
    jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'is_admin', resource: 'global' }]);

    const perms = await pdpService.getEffectivePermissions(mockUserId, [mockAdminRole]);

    expect(perms).toContain('project:delete');
    expect(redisClient.setEx).toHaveBeenCalledWith(
      `user_permissions:${mockUserId}`,
      300,
      JSON.stringify(['project:delete'])
    );
  });

  test('should degrade gracefully when Redis is unavailable', async () => {
    redisClient.isOpen = false;
    redisClient.isReady = false;
    redisClient.setEx.mockClear();

    jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
      'task:approve': [{ name: 'can_approve', resource: 'task' }]
    });
    jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'can_approve', resource: 'task' }]);

    const perms = await pdpService.getEffectivePermissions(mockUserId, [mockViewerRole]);

    expect(perms).toContain('task:approve');
    expect(redisClient.setEx).not.toHaveBeenCalled();
  });

  test('should invalidate matching user keys when Redis is live', async () => {
    const keys = [`user_permissions:${mockUserId}`, `user_permissions:${mockUserId}:project:5`];
    jest.spyOn(redisClient, 'keys').mockResolvedValue(keys);
    jest.spyOn(redisClient, 'del').mockResolvedValue(2);

    const deleted = await pdpService.invalidateUserPermissionCache(mockUserId);

    expect(deleted).toBe(true);
    expect(redisClient.del).toHaveBeenCalledTimes(2);
  });

  test('should return false when invalidation is attempted without Redis', async () => {
    redisClient.isOpen = false;
    redisClient.isReady = false;

    const deleted = await pdpService.invalidateUserPermissionCache(mockUserId);

    expect(deleted).toBe(false);
  });

  test('should invalidate all user permission keys when Redis is available', async () => {
    const keys = [`user_permissions:1`, `user_permissions:2`, `user_permissions:3`];
    jest.spyOn(redisClient, 'keys').mockResolvedValue(keys);
    jest.spyOn(redisClient, 'del').mockResolvedValue(1);

    const deleted = await pdpService.invalidateAllPermissionCaches();

    expect(deleted).toBe(3);
  });

  test('should recompute permissions after a cache miss without throwing', async () => {
    jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
      'execute:code': [{ name: 'dev', resource: 'global' }]
    });
    jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'dev', resource: 'global' }]);

    const perms = await pdpService.getEffectivePermissions(mockUserId, ['engineer']);

    expect(perms).toContain('execute:code');
  });

  test('should treat Redis errors as non-fatal', async () => {
    jest.spyOn(permissionAttributesRepo, 'getAllPermissionRequirements').mockResolvedValue({
      'read:all': [{ name: 'viewer', resource: 'global' }]
    });
    jest.spyOn(roleAttributesRepo, 'getAttributesByRole').mockResolvedValue([{ name: 'viewer', resource: 'global' }]);
    jest.spyOn(redisClient, 'get').mockRejectedValue(new Error('Redis connection lost'));
    jest.spyOn(redisClient, 'setEx').mockRejectedValue(new Error('Redis connection lost'));

    const perms = await pdpService.getEffectivePermissions(mockUserId, ['user']);

    expect(perms).toContain('read:all');
  });
});