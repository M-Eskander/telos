const roleAttributesRepo = require('../../src/repositories/roleAttributes.repos');

// Mock knex
jest.mock('../../src/config/knex');
const knex = require('../../src/config/knex');
const redisClient = require('../../src/redis/client');

describe('Role Attributes Repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.isOpen = false;
    redisClient.isReady = false;
  });

  describe('getAttributesByRole', () => {
    test('should return attributes for existing role', async () => {
      const mockRole = { id: 1, name: 'admin' };
      const mockAttributes = [
        { name: 'is_admin', resource: 'global', resource_id: null },
        { name: 'can_delete', resource: 'global', resource_id: null }
      ];

      const mockRoleQuery = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(mockRole)
      };

      const mockAttrQuery = {
        join: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(mockAttributes)
      };

      knex.mockReturnValueOnce(mockRoleQuery).mockReturnValueOnce(mockAttrQuery);

      const result = await roleAttributesRepo.getAttributesByRole('admin');

      expect(knex).toHaveBeenCalledWith('roles');
      expect(mockRoleQuery.where).toHaveBeenCalledWith({ name: 'admin' });
      expect(mockRoleQuery.first).toHaveBeenCalled();

      expect(knex).toHaveBeenCalledWith('role_attributes');
      expect(mockAttrQuery.join).toHaveBeenCalledWith(
        'attributes',
        'role_attributes.attribute_id',
        'attributes.id'
      );
      expect(mockAttrQuery.where).toHaveBeenCalledWith({ role_id: 1 });
      expect(mockAttrQuery.select).toHaveBeenCalledWith('attributes.name', 'attributes.resource', 'role_attributes.resource_id');

      expect(result).toEqual(mockAttributes);
    });

    test('should return empty array for non-existent role', async () => {
      const mockRoleQuery = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null)
      };

      knex.mockReturnValue(mockRoleQuery);

      const result = await roleAttributesRepo.getAttributesByRole('nonexistent');

      expect(result).toEqual([]);
      // Should not query role_attributes if role doesn't exist
      expect(knex).toHaveBeenCalledTimes(1);
    });

    describe('linkRoleAttribute and removeRoleAttribute', () => {
      test('returns an existing role-attribute link without inserting it', async () => {
        const existing = { id: 8, role_id: 1, attribute_id: 5, resource_id: 12 };
        const query = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(existing)
        };
        knex.mockReturnValue(query);

        await expect(roleAttributesRepo.linkRoleAttribute(1, 5, null, 12)).resolves.toBe(existing);
        expect(query.where).toHaveBeenCalledWith({
          role_id: 1,
          attribute_id: 5,
          resource_id: 12
        });
        expect(query.first).toHaveBeenCalled();
        expect(redisClient.keys).not.toHaveBeenCalled();
      });

      test('inserts a missing link and invalidates users assigned to its role', async () => {
        redisClient.isReady = true;
        redisClient.keys.mockResolvedValue(['user_permissions:4']);
        redisClient.del.mockResolvedValue(1);
        const existingQuery = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(undefined)
        };
        const returning = jest.fn().mockResolvedValue([{ id: 9, role_id: 2, attribute_id: 6 }]);
        const insert = jest.fn().mockReturnValue({ returning });
        const insertQuery = { insert };
        const usersQuery = {
          where: jest.fn().mockReturnThis(),
          select: jest.fn().mockResolvedValue([{ user_id: 4 }])
        };
        knex.mockReturnValueOnce(existingQuery)
          .mockReturnValueOnce(insertQuery)
          .mockReturnValueOnce(usersQuery);

        const result = await roleAttributesRepo.linkRoleAttribute(2, 6);

        expect(insert).toHaveBeenCalledWith({
          role_id: 2,
          attribute_id: 6,
          resource_id: null,
          value: 'true'
        });
        expect(result).toEqual({ id: 9, role_id: 2, attribute_id: 6 });
        expect(redisClient.keys).toHaveBeenCalledWith('user_permissions:4*');
        expect(redisClient.del).toHaveBeenCalledWith('user_permissions:4');
      });

      test('returns false for an absent link and invalidates after deleting a link', async () => {
        const deletedCount = count => ({
          where: jest.fn().mockReturnThis(),
          delete: jest.fn().mockResolvedValue(count)
        });
        knex.mockReturnValueOnce(deletedCount(0));
        await expect(roleAttributesRepo.removeRoleAttribute(2, 6)).resolves.toBe(false);
        expect(redisClient.keys).not.toHaveBeenCalled();

        knex.mockReturnValueOnce(deletedCount(1));
        await expect(roleAttributesRepo.removeRoleAttribute(2, 6, null, 12)).resolves.toBe(true);
        expect(redisClient.keys).not.toHaveBeenCalled();
      });

      test('rethrows write failures after logging them', async () => {
        const error = new Error('database unavailable');
        const existingQuery = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockRejectedValue(error)
        };
        knex.mockReturnValue(existingQuery);
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(roleAttributesRepo.linkRoleAttribute(2, 6)).rejects.toBe(error);
        expect(errorLog).toHaveBeenCalledWith('Failed to link role attribute: database unavailable');
        errorLog.mockRestore();
      });
    });

    test('invalidates all distinct permission-cache keys for users with the role', async () => {
      redisClient.isOpen = true;
      redisClient.keys
        .mockResolvedValueOnce(['user_permissions:4', 'user_permissions:4:project:12'])
        .mockResolvedValueOnce(['user_permissions:4']);
      redisClient.del.mockResolvedValue(2);
      const usersQuery = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([{ user_id: 4 }, { user_id: 4 }])
      };
      knex.mockReturnValue(usersQuery);

      await roleAttributesRepo.invalidateRolePermissionCache(2);

      expect(usersQuery.where).toHaveBeenCalledWith({ role_id: 2 });
      expect(redisClient.del).toHaveBeenCalledWith(
        'user_permissions:4',
        'user_permissions:4:project:12'
      );
    });
  });
});