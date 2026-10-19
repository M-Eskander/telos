jest.mock('../../src/services/accessControl.service');

const accessControlService = require('../../src/services/accessControl.service');
const controller = require('../../src/controllers/accessControl.controller');

describe('Access-control controller error propagation', () => {
  const cases = [
    ['listPeople', 'listPeople', {}],
    ['getPerson', 'getPersonAccessDetails', { params: { userId: '1' } }],
    ['createPerson', 'createPerson', {
      body: {
        name: 'Person',
        email: 'person@example.com',
        phone_number: '5550100',
        password: 'password',
        contract_start_date: '2026-01-01',
        contract_end_date: '2027-01-01'
      },
      file: { buffer: Buffer.from('%PDF-1.7') }
    }],
    ['updatePerson', 'updatePerson', { params: { userId: '1' }, body: {} }],
    ['setPersonRoles', 'setPersonRoles', { params: { userId: '1' }, body: { roles: [] } }],
    ['listRoles', 'listRoles', {}],
    ['getRole', 'getRoleAccessDetails', { params: { roleId: '1' } }],
    ['createRole', 'createRole', { body: { name: 'reviewer' } }],
    ['setRoleAttributes', 'setRoleAttributes', { params: { roleId: '1' }, body: { attributes: [] } }],
    ['listAttributes', 'listAttributes', {}],
    ['createAttribute', 'createAttribute', { body: { name: 'is_reviewer', resource: 'global' } }],
    ['setPersonAttributes', 'setPersonAttributes', { params: { userId: '1' }, body: { attributes: [] } }],
    ['listPermissions', 'listPermissions', {}],
    ['createPermission', 'createPermission', { body: { action: 'read', resource: 'project' } }],
    ['setPermissionGrantGroups', 'setPermissionGrantGroups', {
      params: { permissionId: '1' },
      body: { alternatives: [] }
    }]
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(cases)('%s forwards unexpected service failures to Express', async (
    handlerName,
    serviceMethod,
    req
  ) => {
    const error = new Error('database unavailable');
    accessControlService[serviceMethod].mockRejectedValue(error);
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await controller[handlerName](req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
