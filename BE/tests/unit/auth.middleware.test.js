const passport = require('passport');
const { checkPerm } = require('../../src/middleware/auth.middleware');
const pdpService = require('../../src/services/pdp.service');

// Mock dependencies
jest.mock('passport');
jest.mock('../../src/services/pdp.service');

describe('Auth Middleware - checkPerm', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      isAuthenticated: jest.fn(),
      user: { id: 1, roles: ['admin'] }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  test('should call next() when user has required permission', async () => {
    req.isAuthenticated.mockReturnValue(true);
    pdpService.getEffectivePermissions.mockResolvedValue(['read:project', 'create:project']);

    const middleware = checkPerm('read:project');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should return 403 when user lacks required permission', async () => {
    req.isAuthenticated.mockReturnValue(true);
    pdpService.getEffectivePermissions.mockResolvedValue(['read:project']); // missing create:project

    const middleware = checkPerm('create:project');
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Insufficient permissions' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should return 401 when user is not authenticated', async () => {
    req.isAuthenticated.mockReturnValue(false);

    const middleware = checkPerm('read:project');
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
    expect(pdpService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  test('should return 500 when PDP service throws error', async () => {
    req.isAuthenticated.mockReturnValue(true);
    pdpService.getEffectivePermissions.mockRejectedValue(new Error('Database error'));

    const middleware = checkPerm('read:project');
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Permission check failed' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should handle user with no roles', async () => {
    req.isAuthenticated.mockReturnValue(true);
    req.user.roles = [];
    pdpService.getEffectivePermissions.mockResolvedValue([]);

    const middleware = checkPerm('read:project');
    await middleware(req, res, next);

    expect(pdpService.getEffectivePermissions).toHaveBeenCalledWith(1, []);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('should handle user with undefined roles', async () => {
    req.isAuthenticated.mockReturnValue(true);
    req.user.roles = undefined;
    pdpService.getEffectivePermissions.mockResolvedValue([]);

    const middleware = checkPerm('read:project');
    await middleware(req, res, next);

    expect(pdpService.getEffectivePermissions).toHaveBeenCalledWith(1, []);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});