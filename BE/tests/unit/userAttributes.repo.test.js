const userAttributesRepo = require('../../src/repositories/userAttributes.repo');

// Mock knex
jest.mock('../../src/config/knex');
const knex = require('../../src/config/knex');

describe('User Attributes Repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAttributesByUser', () => {
    test('should return joined attribute data with name and mode', async () => {
      const mockRows = [
        { name: 'is_admin', mode: 'add', value: 'true' },
        { name: 'is_owner', mode: 'remove', value: null }
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
      expect(mockQuery.select).toHaveBeenCalledWith('attributes.name', 'user_attributes.mode', 'user_attributes.value');
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
  });
});