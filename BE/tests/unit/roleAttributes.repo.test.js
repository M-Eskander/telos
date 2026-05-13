const roleAttributesRepo = require('../../src/repositories/roleAttributes.repos');

// Mock knex
jest.mock('../../src/config/knex');
const knex = require('../../src/config/knex');

describe('Role Attributes Repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAttributesByRole', () => {
    test('should return attributes for existing role', async () => {
      const mockRole = { id: 1, name: 'admin' };
      const mockAttributes = [
        { name: 'is_admin', description: 'Administrator access' },
        { name: 'can_delete', description: 'Can delete resources' }
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
      expect(mockAttrQuery.select).toHaveBeenCalledWith('attributes.name', 'attributes.description');

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
  });
});