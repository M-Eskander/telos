jest.mock('../../src/config/knex', () => ({
  transaction: jest.fn(async (fn) => fn({}))
}));

jest.mock('../../src/repositories/user.repo', () => ({
  findByEmail: jest.fn(),
  findById: jest.fn(),
  insertUser: jest.fn()
}));

jest.mock('../../src/repositories/role.repo', () => ({
  findOrCreate: jest.fn()
}));

jest.mock('../../src/repositories/userRole.repo', () => ({
  linkUserRole: jest.fn(),
  getRolesForUser: jest.fn()
}));

const authService = require('../../src/services/auth.service');
const knex = require('../../src/config/knex');
const userRepo = require('../../src/repositories/user.repo');
const roleRepo = require('../../src/repositories/role.repo');
const userRoleRepo = require('../../src/repositories/userRole.repo');
const pdpService = require('../../src/services/pdp.service');
const projectRepo = require('../../src/repositories/project.repo');
const { checkPerm } = require('../../src/middleware/auth.middleware');

describe('security regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createUser ignores client-supplied privileged roles', async () => {
    userRepo.insertUser.mockResolvedValue({ id: 7, email: 'user@example.com' });
    userRepo.findById.mockResolvedValue({ id: 7, name: 'User', email: 'user@example.com', phone_number: '123' });
    userRoleRepo.getRolesForUser.mockResolvedValue([{ name: 'user' }]);
    roleRepo.findOrCreate.mockImplementation(async (name) => ({ id: 99, name }));

    const created = await authService.createUser({
      name: 'User',
      phone_number: '123',
      email: 'user@example.com',
      password: 'secret',
      roles: ['admin', 'user']
    });

    expect(roleRepo.findOrCreate).toHaveBeenCalledTimes(1);
    expect(roleRepo.findOrCreate).toHaveBeenCalledWith('user', expect.anything());
    expect(userRoleRepo.linkUserRole).toHaveBeenCalledTimes(1);
    expect(userRoleRepo.linkUserRole).toHaveBeenCalledWith(7, 99, expect.anything());
    expect(created.roles).toEqual([{ name: 'user' }]);
  });

  test('checkPerm normalizes legacy bare permission names to resource permissions', async () => {
    jest.spyOn(pdpService, 'getEffectivePermissions').mockResolvedValue(['read:project']);
    jest.spyOn(projectRepo, 'getProjectById').mockResolvedValue({ id: 42, created_by: 1 });

    const req = {
      isAuthenticated: () => true,
      user: { id: 1, roles: ['user'] },
      params: { id: '42' }
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await checkPerm('read', 'project')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
