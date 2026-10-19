const userAttributesRepo = require('../../src/repositories/userAttributes.repo');

// Mock knex
jest.mock('../../src/config/knex');
const knex = require('../../src/config/knex');
const redisClient = require('../../src/redis/client');

describe('User Attributes Repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.isOpen = false;
    redisClient.isReady = false;
  });

  describe('getAttributesByUser', () => {
    test('should return joined attribute data with name and mode', async () => {
      const mockRows = [
        { name: 'is_admin', resource: 'global', resource_id: null, mode: 'add', value: 'true' },
        { name: 'is_owner', resource: 'project', resource_id: 1, mode: 'remove', value: null }
      ];

      const mockQuery = {
        join: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(mockRows)
      };

      knex.mockReturnValue(mockQuery);

      const result = await userAttributesRepo.getAttributesByUser(1);

      expect(knex).toHaveBeenCalledWith('user_attributes');
      expect(mockQuery.join).toHaveBeenCalledWith(
        'attributes',
        'user_attributes.attribute_id',
        'attributes.id'
      );
      expect(mockQuery.where).toHaveBeenCalledWith({ user_id: 1 });
      expect(mockQuery.select).toHaveBeenCalledWith(
        'attributes.name',
        'attributes.resource',
        'user_attributes.resource_id',
        'user_attributes.mode',
        'user_attributes.value'
      );
      expect(result).toEqual(mockRows);
    });

    test('should handle empty results', async () => {
      const mockQuery = {
        join: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      };

      knex.mockReturnValue(mockQuery);

      const result = await userAttributesRepo.getAttributesByUser(999);

      expect(result).toEqual([]);
    });

    describe('insertOrUpdateAttributes', () => {
      test('inserts the first attribute record for a user', async () => {
        const lookup = {
          join: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          select: jest.fn().mockResolvedValue([])
        };
        const insert = jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 11, user_id: 4, attributes: ['viewer'] }])
        });
        knex.mockReturnValueOnce(lookup).mockReturnValueOnce({ insert });

        const result = await userAttributesRepo.insertOrUpdateAttributes(4, ['viewer']);

        expect(insert).toHaveBeenCalledWith({ user_id: 4, attributes: ['viewer'] });
        expect(result).toEqual([{ id: 11, user_id: 4, attributes: ['viewer'] }]);
      });

      test('updates existing attribute records', async () => {
        const lookup = {
          join: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          select: jest.fn().mockResolvedValue([{ name: 'viewer' }])
        };
        const returning = jest.fn().mockResolvedValue([{ id: 11, attributes: ['admin'] }]);
        const update = jest.fn().mockReturnValue({ returning });
        const writeQuery = {
          where: jest.fn().mockReturnThis(),
          update
        };
        knex.mockReturnValueOnce(lookup).mockReturnValueOnce(writeQuery);

        const result = await userAttributesRepo.insertOrUpdateAttributes(4, ['admin']);

        expect(writeQuery.where).toHaveBeenCalledWith({ user_id: 4 });
        expect(update).toHaveBeenCalledWith({ attributes: ['admin'] });
        expect(result).toEqual([{ id: 11, attributes: ['admin'] }]);
      });
    });

    describe('addUserAttribute and removeUserAttribute', () => {
      test('creates a scoped user attribute and invalidates all matching cached keys', async () => {
        redisClient.isOpen = true;
        redisClient.keys.mockResolvedValue(['user_permissions:4', 'user_permissions:4:project:8']);
        redisClient.del.mockResolvedValue(2);
        const attributeLookup = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ id: 3, name: 'is_member' })
        };
        const existingLookup = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(undefined)
        };
        const insert = jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 9, user_id: 4, attribute_id: 3, resource_id: 8 }])
        });
        knex.mockReturnValueOnce(attributeLookup)
          .mockReturnValueOnce(existingLookup)
          .mockReturnValueOnce({ insert });

        const result = await userAttributesRepo.addUserAttribute(4, 'is_member', 'add', null, 8);

        expect(existingLookup.where).toHaveBeenCalledWith({
          user_id: 4,
          attribute_id: 3,
          resource_id: 8
        });
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({
          user_id: 4,
          attribute_id: 3,
          resource_id: 8,
          value: 'true',
          mode: 'add'
        }));
        expect(result).toMatchObject({ id: 9, resource_id: 8 });
        expect(redisClient.keys).toHaveBeenCalledWith('user_permissions:4*');
        expect(redisClient.del).toHaveBeenCalledWith('user_permissions:4', 'user_permissions:4:project:8');
      });

      test('updates an existing attribute and rejects unknown attribute names', async () => {
        const attributeLookup = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ id: 3 })
        };
        const existingLookup = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ id: 12 })
        };
        const returning = jest.fn().mockResolvedValue([{ id: 12, mode: 'remove' }]);
        const update = jest.fn().mockReturnValue({ returning });
        const updateQuery = { where: jest.fn().mockReturnThis(), update };
        knex.mockReturnValueOnce(attributeLookup)
          .mockReturnValueOnce(existingLookup)
          .mockReturnValueOnce(updateQuery);

        await expect(userAttributesRepo.addUserAttribute(4, 'is_member', 'remove'))
          .resolves.toMatchObject({ id: 12, mode: 'remove' });
        expect(updateQuery.where).toHaveBeenCalledWith({ id: 12 });
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ mode: 'remove' }));

        const missingAttribute = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(undefined)
        };
        knex.mockReturnValueOnce(missingAttribute);
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(userAttributesRepo.addUserAttribute(4, 'missing'))
          .rejects.toThrow('Attribute not found: missing');
        expect(errorLog).toHaveBeenCalled();
        errorLog.mockRestore();
      });

      test('removes a matching user attribute and does not invalidate when nothing was removed', async () => {
        const attributeLookup = () => ({
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ id: 3 })
        });
        const deleteQuery = deleted => ({
          where: jest.fn().mockReturnThis(),
          delete: jest.fn().mockResolvedValue(deleted)
        });
        knex.mockReturnValueOnce(attributeLookup())
          .mockReturnValueOnce(deleteQuery(1));
        redisClient.isReady = true;
        redisClient.keys.mockResolvedValue([]);
        await expect(userAttributesRepo.removeUserAttribute(4, 'is_member')).resolves.toBe(true);
        expect(redisClient.keys).toHaveBeenCalledWith('user_permissions:4*');

        redisClient.keys.mockClear();
        knex.mockReturnValueOnce(attributeLookup())
          .mockReturnValueOnce(deleteQuery(0));
        await expect(userAttributesRepo.removeUserAttribute(4, 'is_member')).resolves.toBe(false);
        expect(redisClient.keys).not.toHaveBeenCalled();
      });
    });

    test('invalidates caches for every user assigned a role', async () => {
      redisClient.isOpen = true;
      const usersQuery = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([{ user_id: 4 }, { user_id: 5 }])
      };
      knex.mockReturnValue(usersQuery);
      redisClient.keys
        .mockResolvedValueOnce(['user_permissions:4', 'user_permissions:4:project:8'])
        .mockResolvedValueOnce(['user_permissions:5']);

      await userAttributesRepo.invalidateRolePermissionCache(7);

      expect(usersQuery.where).toHaveBeenCalledWith({ role_id: 7 });
      expect(redisClient.keys).toHaveBeenCalledTimes(2);
      expect(redisClient.del).toHaveBeenCalledWith(
        'user_permissions:4',
        'user_permissions:4:project:8',
        'user_permissions:5'
      );
    });
  });
});