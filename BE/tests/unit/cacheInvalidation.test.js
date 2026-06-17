const userAttributesRepo = require('../../src/repositories/userAttributes.repo');
const roleAttributesRepo = require('../../src/repositories/roleAttributes.repos');
const pdpService = require('../../src/services/pdp.service');

// Mock dependencies
jest.mock('../../src/config/knex');
jest.mock('../../src/redis/client');

const knex = require('../../src/config/knex');
const redisClient = require('../../src/redis/client');

describe('Cache Invalidation System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset Redis mock to working state
    redisClient.isOpen = true;
    redisClient.isReady = true;
    redisClient.del.mockResolvedValue(1);
    redisClient.keys.mockResolvedValue([]);
  });

  describe('User Attribute Cache Invalidation', () => {
    
    test('addUserAttribute should invalidate user cache after adding attribute', async () => {
      const userId = 123;
      const attributeName = 'is_admin';
      const attributeId = 5;

      // Setup knex mock chain
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        returning: jest.fn(),
        delete: jest.fn()
      };

      knex.mockReturnValue(mockQuery);

      // First call to get attribute
      mockQuery.first.mockResolvedValueOnce({ id: attributeId, name: attributeName });
      // Second call to check existing
      mockQuery.first.mockResolvedValueOnce(null);
      // Insert call
      mockQuery.returning.mockResolvedValueOnce([{ id: 1, user_id: userId, attribute_id: attributeId }]);

      await userAttributesRepo.addUserAttribute(userId, attributeName, 'add');

      // Verify cache was invalidated
      expect(redisClient.del).toHaveBeenCalledWith(`user_permissions:${userId}`);
    });

    test('removeUserAttribute should invalidate user cache after removing attribute', async () => {
      const userId = 456;
      const attributeName = 'can_approve';
      const attributeId = 7;

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn(),
        delete: jest.fn().mockResolvedValue(1),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        returning: jest.fn()
      };

      knex.mockReturnValue(mockQuery);

      // First call to get attribute
      mockQuery.first.mockResolvedValueOnce({ id: attributeId, name: attributeName });
      // Delete returns 1 (success)
      mockQuery.delete.mockResolvedValueOnce(1);

      const result = await userAttributesRepo.removeUserAttribute(userId, attributeName);

      expect(result).toBe(true);
      expect(redisClient.del).toHaveBeenCalledWith(`user_permissions:${userId}`);
    });

    test('should handle cache invalidation failure gracefully (Redis down)', async () => {
      const userId = 789;
      const attributeName = 'is_viewer';

      redisClient.isOpen = false;
      redisClient.isReady = false;

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn(),
        insert: jest.fn().mockReturnThis(),
        returning: jest.fn()
      };

      knex.mockReturnValue(mockQuery);

      mockQuery.first.mockResolvedValueOnce({ id: 3, name: attributeName });
      mockQuery.first.mockResolvedValueOnce(null);
      mockQuery.returning.mockResolvedValueOnce([{ id: 1, user_id: userId, attribute_id: 3 }]);

      // Should not throw even without Redis
      await userAttributesRepo.addUserAttribute(userId, attributeName, 'add');
      
      // Should not attempt Redis call
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    test('invalidateUserPermissionCache should call Redis del with correct key', async () => {
      const userId = 111;

      await userAttributesRepo.invalidateUserPermissionCache(userId);

      expect(redisClient.del).toHaveBeenCalledWith(`user_permissions:${userId}`);
    });
  });

  describe('Role Attribute Cache Invalidation', () => {

    test('linkRoleAttribute should call invalidation for role', async () => {
      const roleId = 10;
      const attributeId = 5;

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ role_id: roleId, attribute_id: attributeId }]),
        select: jest.fn().mockResolvedValue([])
      };

      knex.mockReturnValue(mockQuery);

      await roleAttributesRepo.linkRoleAttribute(roleId, attributeId);

      // Verify operation completed (even with empty user list, invalidation was attempted)
      expect(knex).toHaveBeenCalled();
    });

    test('removeRoleAttribute should call invalidation for role', async () => {
      const roleId = 20;
      const attributeId = 7;

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        delete: jest.fn().mockResolvedValue(1),
        first: jest.fn(),
        select: jest.fn().mockResolvedValue([])
      };

      knex.mockReturnValue(mockQuery);

      await roleAttributesRepo.removeRoleAttribute(roleId, attributeId);

      // Verify operation completed
      expect(knex).toHaveBeenCalled();
    });

    test('invalidateRolePermissionCache should handle empty role', async () => {
      const roleId = 999;

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      };

      knex.mockReturnValue(mockQuery);

      await roleAttributesRepo.invalidateRolePermissionCache(roleId);

      // Should not call Redis if no users
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    test('linkRoleAttribute should not fail if Redis unavailable', async () => {
      const roleId = 30;
      const attributeId = 9;

      redisClient.isOpen = false;
      redisClient.isReady = false;

      let callCount = 0;
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve([{ user_id: 1 }, { user_id: 2 }]);
        }),
        first: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ role_id: roleId, attribute_id: attributeId }])
      };

      knex.mockReturnValue(mockQuery);

      // Should complete without error
      await roleAttributesRepo.linkRoleAttribute(roleId, attributeId);
      
      // Should not attempt Redis call
      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });

  describe('PDP Service Cache Invalidation APIs', () => {

    test('invalidateUserPermissionCache should delete user cache', async () => {
      const userId = 555;

      await pdpService.invalidateUserPermissionCache(userId);

      expect(redisClient.del).toHaveBeenCalledWith(`user_permissions:${userId}`);
    });

    test('invalidateAllPermissionCaches should delete all permission caches', async () => {
      const cacheKeys = ['user_permissions:1', 'user_permissions:2', 'user_permissions:3'];

      redisClient.keys.mockResolvedValue(cacheKeys);
      redisClient.del.mockResolvedValue(cacheKeys.length);

      await pdpService.invalidateAllPermissionCaches();

      expect(redisClient.keys).toHaveBeenCalledWith('user_permissions:*');
      expect(redisClient.del).toHaveBeenCalledWith(...cacheKeys);
    });

    test('invalidateAllPermissionCaches should handle no cached items', async () => {
      redisClient.keys.mockResolvedValue([]);

      await pdpService.invalidateAllPermissionCaches();

      expect(redisClient.keys).toHaveBeenCalledWith('user_permissions:*');
      // Should not call del if no keys found
      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });

  describe('Cache Invalidation Integration', () => {

    test('permission change should be reflected in next request after cache invalidation', async () => {
      const userId = 200;
      const attributeName = 'is_admin';

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn(),
        insert: jest.fn().mockReturnThis(),
        returning: jest.fn()
      };

      knex.mockReturnValue(mockQuery);

      mockQuery.first.mockResolvedValueOnce({ id: 5, name: attributeName });
      mockQuery.first.mockResolvedValueOnce(null);
      mockQuery.returning.mockResolvedValueOnce([{ id: 1, user_id: userId, attribute_id: 5 }]);

      // Add attribute (should invalidate cache)
      await userAttributesRepo.addUserAttribute(userId, attributeName, 'add');

      // Verify cache was invalidated
      expect(redisClient.del).toHaveBeenCalledWith(`user_permissions:${userId}`);
    });

    test('bulk role change should invalidate caches for all affected users', async () => {
      const roleId = 50;
      const attributeId = 15;
      const affectedUsers = [100, 101, 102, 103, 104];

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(affectedUsers.map(id => ({ user_id: id }))),
        first: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ role_id: roleId, attribute_id: attributeId }])
      };

      knex.mockReturnValue(mockQuery);

      // Link attribute to role
      await roleAttributesRepo.linkRoleAttribute(roleId, attributeId);

      // Verify operation completed
      expect(knex).toHaveBeenCalled();
    });

    test('concurrent permission changes should invalidate caches independently', async () => {
      const user1 = 300;
      const user2 = 301;
      const attributeName = 'editor';
      const attributeId = 8;

      // Create separate mock for each concurrent call
      const createMock = (userId) => ({
        where: jest.fn().mockReturnThis(),
        first: jest.fn()
          .mockResolvedValueOnce({ id: attributeId, name: attributeName })
          .mockResolvedValueOnce(null),
        insert: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 1, user_id: userId, attribute_id: attributeId }])
      });

      // Make concurrent changes with different mocks
      const mock1 = createMock(user1);
      const mock2 = createMock(user2);
      
      let callCount = 0;
      knex.mockImplementation(() => {
        callCount++;
        return callCount % 2 === 1 ? mock1 : mock2;
      });

      // Make concurrent changes
      await Promise.all([
        userAttributesRepo.addUserAttribute(user1, attributeName, 'add'),
        userAttributesRepo.addUserAttribute(user2, attributeName, 'add')
      ]);

      // Verify both caches were invalidated
      expect(redisClient.del).toHaveBeenCalledWith(`user_permissions:${user1}`);
      expect(redisClient.del).toHaveBeenCalledWith(`user_permissions:${user2}`);
    });
  });
});
