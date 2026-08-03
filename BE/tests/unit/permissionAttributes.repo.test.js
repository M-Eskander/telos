const permissionAttributesRepo = require('../../src/repositories/permissionAttributes.repo');

// Mock knex
jest.mock('../../src/config/knex');
const knex = require('../../src/config/knex');

// Mock the getAttributesByPermission method
jest.spyOn(permissionAttributesRepo, 'getAttributesByPermission');

describe('Permission Attributes Repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllPermissionRequirements', () => {
    test('should return correct permission-to-attribute mapping', async () => {
      const mockRows = [
        { action: 'create', resource: 'project', name: 'is_admin' },
        { action: 'create', resource: 'project', name: 'is_owner' },
        { action: 'read', resource: 'project', name: 'is_viewer' },
        { action: 'delete', resource: 'task', name: 'is_admin' }
      ];

      const mockQuery = {
        join: jest.fn().mockReturnThis(),
        join: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(mockRows)
      };

      // Mock the chained joins
      mockQuery.join.mockReturnValue(mockQuery);

      knex.mockReturnValue(mockQuery);

      const result = await permissionAttributesRepo.getAllPermissionRequirements();

      expect(knex).toHaveBeenCalledWith('permissions');
      expect(mockQuery.join).toHaveBeenCalledWith('permission_attributes', 'permissions.id', 'permission_attributes.permission_id');
      expect(mockQuery.join).toHaveBeenCalledWith('attributes', 'permission_attributes.attribute_id', 'attributes.id');
      expect(mockQuery.select).toHaveBeenCalledWith('permissions.action', 'permissions.resource', 'attributes.name');

      expect(result).toEqual({
        'create:project': [
          { name: 'is_admin', resource: 'project', resourceId: undefined },
          { name: 'is_owner', resource: 'project', resourceId: undefined }
        ],
        'read:project': [
          { name: 'is_viewer', resource: 'project', resourceId: undefined }
        ],
        'delete:task': [
          { name: 'is_admin', resource: 'task', resourceId: undefined }
        ]
      });
    });

    test('should handle permissions with no attributes', async () => {
      const mockRows = [
        { action: 'read', resource: 'public', name: null } // No attributes
      ];

      const mockQuery = {
        join: jest.fn().mockReturnThis(),
        join: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      };

      mockQuery.join.mockReturnValue(mockQuery);

      knex.mockReturnValue(mockQuery);

      const result = await permissionAttributesRepo.getAllPermissionRequirements();

      expect(result).toEqual({});
    });

    test('should handle empty results', async () => {
      const mockQuery = {
        join: jest.fn().mockReturnThis(),
        join: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      };

      mockQuery.join.mockReturnValue(mockQuery);

      knex.mockReturnValue(mockQuery);

      const result = await permissionAttributesRepo.getAllPermissionRequirements();

      expect(result).toEqual({});
    });
  });

  describe('getAttributesByPermission', () => {
    test('should return joined attribute data for permission', async () => {
      const mockRows = [
        { name: 'is_admin' },
        { name: 'is_owner' }
      ];

      const mockQuery = {
        join: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(mockRows)
      };

      knex.mockReturnValue(mockQuery);

      const result = await permissionAttributesRepo.getAttributesByPermission(1);

      expect(knex).toHaveBeenCalledWith('permission_attributes');
      expect(mockQuery.join).toHaveBeenCalledWith(
        'attributes',
        'permission_attributes.attribute_id',
        'attributes.id'
      );
      expect(mockQuery.where).toHaveBeenCalledWith({ permission_id: 1 });
      expect(mockQuery.select).toHaveBeenCalledWith('attributes.name');

      expect(result).toEqual(mockRows);
    });
  });

  describe('insertOrUpdateAttributes', () => {
    test('should delete existing and insert new attributes', async () => {
      const mockDeleteQuery = {
        where: jest.fn().mockReturnThis(),
        delete: jest.fn().mockResolvedValue(1)
      };

      const mockInsertQuery = {
        insert: jest.fn().mockResolvedValue([1, 2])
      };

      const mockAttrQuery = {
        whereIn: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }])
      };

      const mockGetAttrQuery = {
        join: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([{ name: 'is_admin' }, { name: 'is_owner' }])
      };

      // Mock knex to return different query builders based on table name
      knex.mockImplementation((table) => {
        if (table === 'permission_attributes') {
          const query = {
            where: jest.fn().mockReturnThis(),
            delete: jest.fn().mockResolvedValue(1),
            insert: jest.fn().mockResolvedValue([1, 2]),
            join: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue([])
          };
          return query;
        } else if (table === 'attributes') {
          return mockAttrQuery;
        }
        return {};
      });

      const result = await permissionAttributesRepo.insertOrUpdateAttributes(1, ['is_admin', 'is_owner']);

      expect(knex).toHaveBeenCalledWith('permission_attributes');
      expect(result).toBeDefined();
    });

    test('should handle empty attribute list', async () => {
      // Mock knex to return different query builders based on table name
      knex.mockImplementation((table) => {
        if (table === 'permission_attributes') {
          const query = {
            where: jest.fn().mockReturnThis(),
            delete: jest.fn().mockResolvedValue(0),
            join: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue([])
          };
          return query;
        }
        return {};
      });

      const result = await permissionAttributesRepo.insertOrUpdateAttributes(1, []);

      expect(knex).toHaveBeenCalledWith('permission_attributes');
      expect(result).toBeDefined();
    });
  });
});