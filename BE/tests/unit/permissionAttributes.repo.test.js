const permissionAttributesRepo = require('../../src/repositories/permissionAttributes.repo');

jest.mock('../../src/config/knex');
const knex = require('../../src/config/knex');

describe('Permission Attributes Repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    knex.transaction = jest.fn();
  });

  test('groups required attributes into alternative AND rules', async () => {
    const query = {
      join: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([
        { action: 'update', permission_resource: 'project', grant_group: 0, name: 'is_manager', attribute_resource: 'project' },
        { action: 'update', permission_resource: 'project', grant_group: 0, name: 'is_active', attribute_resource: 'global' },
        { action: 'update', permission_resource: 'project', grant_group: 1, name: 'is_owner', attribute_resource: 'global' }
      ])
    };
    knex.mockReturnValue(query);

    const result = await permissionAttributesRepo.getAllPermissionRequirements();

    expect(query.join).toHaveBeenCalledWith(
      'permission_grant_groups',
      'permissions.id',
      'permission_grant_groups.permission_id'
    );
    expect(query.leftJoin).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      'update:project': [
        [
          { name: 'is_manager', resource: 'project' },
          { name: 'is_active', resource: 'global' }
        ],
        [{ name: 'is_owner', resource: 'global' }]
      ]
    });
  });

  test('preserves an explicitly empty public grant group', async () => {
    const query = {
      join: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([
        { action: 'read', permission_resource: 'public', grant_group: 0, name: null }
      ])
    };
    knex.mockReturnValue(query);

    await expect(permissionAttributesRepo.getAllPermissionRequirements()).resolves.toEqual({
      'read:public': [[]]
    });
  });

  test('persists grant alternatives transactionally', async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ id: 4, resource: 'project' }),
      whereIn: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      join: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis()
    };
    query.select.mockImplementation(() => {
      if (knex.mock.calls[knex.mock.calls.length - 1][0] === 'attributes') {
        return Promise.resolve([{ id: 1 }, { id: 2 }]);
      }
      return Promise.resolve([
        { action: 'read', permission_resource: 'project', grant_group: 0, name: 'is_active', attribute_resource: 'global' },
        { action: 'read', permission_resource: 'project', grant_group: 1, name: 'is_owner', attribute_resource: 'project' }
      ]);
    });
    const writes = [];
    knex.transaction.mockImplementation(async callback => callback(tableName => ({
      where: jest.fn().mockReturnThis(),
      delete: jest.fn().mockResolvedValue(0),
      insert: jest.fn(records => {
        writes.push({ tableName, records });
        return Promise.resolve([1]);
      })
    })));
    knex.mockReturnValue(query);

    const result = await permissionAttributesRepo.replaceGrantGroups(4, [[1], [1, 2]]);

    expect(writes).toContainEqual({
      tableName: 'permission_grant_groups',
      records: [{ permission_id: 4, grant_group: 0 }, { permission_id: 4, grant_group: 1 }]
    });
    expect(writes).toContainEqual({
      tableName: 'permission_attributes',
      records: [
        { permission_id: 4, attribute_id: 1, grant_group: 0 },
        { permission_id: 4, attribute_id: 1, grant_group: 1 },
        { permission_id: 4, attribute_id: 2, grant_group: 1 }
      ]
    });
    expect(result['read:project']).toHaveLength(2);
  });

  test('rejects grant groups containing unknown attributes before replacing existing grants', async () => {
    const query = {
      whereIn: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([])
    };
    knex.mockReturnValue(query);

    await expect(permissionAttributesRepo.replaceGrantGroups(4, [[999]])).rejects.toThrow(
      'One or more permission grant attributes do not exist'
    );
    expect(knex.transaction).not.toHaveBeenCalled();
  });

  test('rejects empty grant rules for non-public permissions before changing existing grants', async () => {
    const permissionQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ id: 4, resource: 'project' })
    };
    knex.mockReturnValue(permissionQuery);

    await expect(permissionAttributesRepo.replaceGrantGroups(4, [[]])).rejects.toThrow(
      'Empty grant rules are only allowed for public permissions'
    );
    expect(knex.transaction).not.toHaveBeenCalled();
  });

  test('allows an explicitly empty rule for a public permission', async () => {
    const permissionQuery = {
      where: jest.fn().mockReturnThis(),
      join: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([
        { action: 'read', permission_resource: 'public', grant_group: 0, name: null }
      ]),
      first: jest.fn().mockResolvedValue({ id: 4, resource: 'public' })
    };
    knex.mockReturnValue(permissionQuery);
    const writes = [];
    knex.transaction.mockImplementation(async callback => callback(tableName => ({
      where: jest.fn().mockReturnThis(),
      delete: jest.fn().mockResolvedValue(0),
      insert: jest.fn(records => {
        writes.push({ tableName, records });
        return Promise.resolve([1]);
      })
    })));

    await expect(permissionAttributesRepo.replaceGrantGroups(4, [[]])).resolves.toEqual({
      'read:public': [[]]
    });
    expect(writes).toContainEqual({
      tableName: 'permission_grant_groups',
      records: [{ permission_id: 4, grant_group: 0 }]
    });
  });
});
