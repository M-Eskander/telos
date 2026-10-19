jest.mock('../../src/config/knex');

const knex = require('../../src/config/knex');
const userRoleRepo = require('../../src/repositories/userRole.repo');

describe('User-role repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('links a global role assignment with an idempotent conflict rule', async () => {
    const ignore = jest.fn().mockResolvedValue([]);
    const onConflict = jest.fn().mockReturnValue({ ignore });
    const insert = jest.fn().mockReturnValue({ onConflict });
    knex.mockReturnValue({ insert });

    await userRoleRepo.linkUserRole(7, 3);

    expect(knex).toHaveBeenCalledWith('user_roles');
    expect(insert).toHaveBeenCalledWith({
      user_id: 7,
      role_id: 3,
      resource_type: null,
      resource_id: null,
      scope_key: ''
    });
    expect(onConflict).toHaveBeenCalledWith(['user_id', 'role_id', 'scope_key']);
    expect(ignore).toHaveBeenCalled();
  });

  test('links and unlinks a resource-scoped role assignment', async () => {
    const ignore = jest.fn().mockResolvedValue([]);
    const onConflict = jest.fn().mockReturnValue({ ignore });
    const insert = jest.fn().mockReturnValue({ onConflict });
    knex.mockReturnValueOnce({ insert });

    await userRoleRepo.linkUserRole(7, 3, null, {
      resourceType: 'project',
      resourceId: 12
    });
    expect(insert).toHaveBeenCalledWith({
      user_id: 7,
      role_id: 3,
      resource_type: 'project',
      resource_id: 12,
      scope_key: 'project:12'
    });

    const del = jest.fn().mockResolvedValue(1);
    const where = jest.fn().mockReturnValue({ del });
    knex.mockReturnValueOnce({ where });
    await userRoleRepo.unlinkUserRole(7, 3, null, {
      resourceType: 'project',
      resourceId: 12
    });
    expect(where).toHaveBeenCalledWith({
      user_id: 7,
      role_id: 3,
      resource_type: 'project',
      resource_id: 12,
      scope_key: 'project:12'
    });
    expect(del).toHaveBeenCalled();
  });

  test('returns role names and detailed assignments from joined rows', async () => {
    const assignments = [
      { name: 'viewer', resourceType: null, resourceId: null },
      { name: 'manager', resourceType: 'project', resourceId: 12 }
    ];
    const select = jest.fn().mockResolvedValue(assignments);
    const where = jest.fn().mockReturnThis();
    const join = jest.fn().mockReturnThis();
    knex.mockReturnValue({ join, where, select });

    await expect(userRoleRepo.getRolesForUser(7)).resolves.toEqual(['viewer', 'manager']);

    const query = {
      join: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue(assignments)
    };
    knex.mockReturnValue(query);
    await expect(userRoleRepo.getRoleAssignmentsForUser(7)).resolves.toEqual(assignments);
    expect(query.join).toHaveBeenCalledWith(
      'roles',
      'user_roles.role_id',
      'roles.id'
    );
    expect(query.where).toHaveBeenCalledWith('user_roles.user_id', 7);
    expect(query.select).toHaveBeenCalledWith(
      'roles.name',
      'user_roles.resource_type as resourceType',
      'user_roles.resource_id as resourceId'
    );
  });
});
