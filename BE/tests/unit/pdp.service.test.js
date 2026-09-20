const { getEffectivePermissions, _clearCache } = require('../../src/services/pdp.service');

// Mock dependencies
jest.mock('../../src/repositories/userAttributes.repo');
jest.mock('../../src/repositories/roleAttributes.repos');
jest.mock('../../src/repositories/permissionAttributes.repo');
jest.mock('../../src/redis/client');

const userAttributesRepo = require('../../src/repositories/userAttributes.repo');
const roleAttributesRepo = require('../../src/repositories/roleAttributes.repos');
const permissionAttributesRepo = require('../../src/repositories/permissionAttributes.repo');
const redisClient = require('../../src/redis/client');

describe('PDP Service - getEffectivePermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the cache before each test
    if (typeof _clearCache === 'function') {
      _clearCache();
    }
    
    // UPDATED: Mock permission requirements cache to use name + resource objects
    permissionAttributesRepo.getAllPermissionRequirements.mockResolvedValue({
      'read:project': [{ name: 'is_viewer', resource: 'project' }],
      'create:project': [{ name: 'is_admin', resource: 'global' }],
      'delete:project': [
        { name: 'is_admin', resource: 'global' },
        { name: 'is_owner', resource: 'project' }
      ],
      'read:task': [{ name: 'is_viewer', resource: 'task' }]
    });

    // Mock Redis as available for the cache-write scenario; tests that need
    // unavailable Redis explicitly set these flags to false.
    redisClient.isOpen = true;
    redisClient.isReady = true;
    redisClient.get.mockResolvedValue(null);
    redisClient.setEx.mockResolvedValue('OK');
  });

  describe('Remove Mode Logic', () => {
    test('should revoke role-granted permission when user has remove mode attribute', async () => {
      // Role grants 'is_admin' globally, user removes 'is_admin' globally
      roleAttributesRepo.getAttributesByRole
        .mockResolvedValueOnce([{ name: 'is_admin', resource: 'global' }]); 
      userAttributesRepo.getAttributesByUser.mockResolvedValue([
        { name: 'is_admin', resource: 'global', mode: 'remove' }
      ]);

      const permissions = await getEffectivePermissions(1, ['admin']);

      expect(permissions).not.toContain('create:project');
      expect(permissions).not.toContain('delete:project');
    });

    test('should grant permission when user adds missing attribute with matching resource context', async () => {
      // Role grants 'is_admin' globally, doesn't grant 'is_owner' for project, user adds it
      roleAttributesRepo.getAttributesByRole
        .mockResolvedValueOnce([{ name: 'is_admin', resource: 'global' }]); 
      userAttributesRepo.getAttributesByUser.mockResolvedValue([
        { name: 'is_owner', resource: 'project', mode: 'add' }
      ]);

      const permissions = await getEffectivePermissions(1, ['admin']);

      expect(permissions).toContain('create:project');
      expect(permissions).toContain('delete:project'); // has both global:is_admin and project:is_owner
    });
  });

  describe('Multiple Role Support', () => {
    test('should merge attributes from multiple roles', async () => {
      roleAttributesRepo.getAttributesByRole
        .mockResolvedValueOnce([{ name: 'is_viewer', resource: 'project' }]) // viewer role
        .mockResolvedValueOnce([{ name: 'is_admin', resource: 'global' }]); // admin role

      userAttributesRepo.getAttributesByUser.mockResolvedValue([]);

      const permissions = await getEffectivePermissions(1, ['viewer', 'admin']);

      expect(permissions).toContain('read:project');
      expect(permissions).toContain('create:project');
    });
  });

  describe('Permission Resolution', () => {
    test('should grant permission when user has all required attributes with exact resources', async () => {
      roleAttributesRepo.getAttributesByRole
        .mockResolvedValue([{ name: 'is_admin', resource: 'global' }, { name: 'is_owner', resource: 'project' }]);
      userAttributesRepo.getAttributesByUser.mockResolvedValue([]);

      const permissions = await getEffectivePermissions(1, ['admin']);

      expect(permissions).toContain('delete:project');
    });

    test('should deny permission when user lacks required attribute resource matching', async () => {
      // Has admin globally, but missing the owner attribute for the specific project resource
      roleAttributesRepo.getAttributesByRole
        .mockResolvedValue([{ name: 'is_admin', resource: 'global' }]); 
      userAttributesRepo.getAttributesByUser.mockResolvedValue([]);

      const permissions = await getEffectivePermissions(1, ['admin']);

      expect(permissions).not.toContain('delete:project');
    });

    test('should grant permission with no required attributes', async () => {
      _clearCache(); // Clear cache to ensure fresh load

      // Mock empty requirements for a permission
      permissionAttributesRepo.getAllPermissionRequirements.mockResolvedValue({
        'read:public': [] // no attributes required
      });

      roleAttributesRepo.getAttributesByRole.mockResolvedValue([]);
      userAttributesRepo.getAttributesByUser.mockResolvedValue([]);

      const permissions = await getEffectivePermissions(1, []);

      expect(permissions).toContain('read:public');
    });
  });

  describe('Caching', () => {
    test('should use cached user permissions when available', async () => {
      const cachedPermissions = ['read:project', 'create:project'];
      redisClient.get.mockResolvedValue(JSON.stringify(cachedPermissions));

      // These should not be called if cache hit
      roleAttributesRepo.getAttributesByRole.mockResolvedValue([]);
      userAttributesRepo.getAttributesByUser.mockResolvedValue([]);

      const permissions = await getEffectivePermissions(1, ['admin']);

      expect(permissions).toEqual(cachedPermissions);
      expect(roleAttributesRepo.getAttributesByRole).not.toHaveBeenCalled();
    });

    test('should cache computed permissions', async () => {
      // Granting is_viewer for project, but not task
      roleAttributesRepo.getAttributesByRole.mockResolvedValue([{ name: 'is_viewer', resource: 'project' }]);
      userAttributesRepo.getAttributesByUser.mockResolvedValue([]);

      const permissions = await getEffectivePermissions(1, ['viewer']);

      expect(redisClient.setEx).toHaveBeenCalledWith(
        'user_permissions:1',
        300,
        JSON.stringify(['read:project']) // 'read:task' will not be here because it requires { name: 'is_viewer', resource: 'task' }
      );
    });

    test('should continue without Redis if unavailable', async () => {
      redisClient.get.mockRejectedValue(new Error('Redis unavailable'));
      redisClient.setEx.mockRejectedValue(new Error('Redis unavailable'));

      roleAttributesRepo.getAttributesByRole.mockResolvedValue([{ name: 'is_viewer', resource: 'project' }]);
      userAttributesRepo.getAttributesByUser.mockResolvedValue([]);

      const permissions = await getEffectivePermissions(1, ['viewer']);

      expect(permissions).toContain('read:project');
    });
  });

  describe('Error Handling', () => {
    test('should throw error when permission requirements cannot be loaded', async () => {
      // Clear the cache to force reload
      _clearCache();

      permissionAttributesRepo.getAllPermissionRequirements.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(getEffectivePermissions(1, ['admin'])).rejects.toThrow('Database connection failed');
    });
  });
});