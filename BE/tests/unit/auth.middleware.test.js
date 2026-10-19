const passport = require('passport');
const { checkPerm } = require('../../src/middleware/auth.middleware');
const pdpService = require('../../src/services/pdp.service');

// FORCE JEST MOCKS USING THE EXACT STRING REQUIRED BY YOUR PROJECT DIRECTORY
jest.mock('passport');
jest.mock('../../src/services/pdp.service');
jest.mock('../../src/repositories/project.repo', () => ({
  getProjectById: jest.fn()
}));
jest.mock('../../src/repositories/task.repo', () => ({
  findById: jest.fn()
}));

const projectRepo = require('../../src/repositories/project.repo');
const taskRepo = require('../../src/repositories/task.repo');

describe('Auth Middleware - checkPerm', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      isAuthenticated: jest.fn(),
      user: { id: 1, roles: ['admin'] },
      params: {},
      body: {},
      query: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
    
    // Reset our explicit mock methods
    projectRepo.getProjectById.mockReset();
    taskRepo.findById.mockReset();
  });

  test('should call next() when user has required permission (Static Route, No Resource Context)', async () => {
    req.isAuthenticated.mockReturnValue(true);
    pdpService.getEffectivePermissions.mockResolvedValue(['read:project', 'create:project']);

    const middleware = checkPerm('create:project');
    await middleware(req, res, next);

    expect(pdpService.getEffectivePermissions).toHaveBeenCalledWith(1, ['admin'], null);
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

  /* NEW: INSTANCE-LEVEL ACCESS CONTROL TESTS */

  describe('Dynamic Instance-Level Resource Resolution', () => {
    test('should resolve real project instance data from URL parameters and pass context to PDP', async () => {
      req.isAuthenticated.mockReturnValue(true);
      req.params.id = '5'; // Simulated URL param: /api/projects/5
      
      const mockProject = { id: '5', name: 'Telos Project', created_by: 1 };
      projectRepo.getProjectById.mockResolvedValue(mockProject);
      pdpService.getEffectivePermissions.mockResolvedValue(['delete:project']);

      // Configure checkPerm for an explicit instance check on resource type 'project'
      const middleware = checkPerm('delete:project', 'project');
      await middleware(req, res, next);

      // 1. Verify project was extracted from DB correctly
      expect(projectRepo.getProjectById).toHaveBeenCalledWith('5');
      
      // 2. Verify expected dynamic owner context was compiled and handed down to PDP service
      expect(pdpService.getEffectivePermissions).toHaveBeenCalledWith(
        1, 
        ['admin'], 
        { resourceId: '5', resourceType: 'project', ownerId: 1 }
      );

      // 3. Verify it saves the loaded object directly onto the request container
      expect(req.project).toEqual(mockProject);
      expect(next).toHaveBeenCalled();
    });

    test('should return 404 error if resource instance is specified but not found in DB', async () => {
      req.isAuthenticated.mockReturnValue(true);
      req.params.id = '999'; // Non-existent ID
      projectRepo.getProjectById.mockResolvedValue(null);

      const middleware = checkPerm('delete:project', 'project');
      await middleware(req, res, next);

      expect(projectRepo.getProjectById).toHaveBeenCalledWith('999');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'project not found' });
      expect(pdpService.getEffectivePermissions).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    test('should support custom named route parameter identifiers (e.g., taskId)', async () => {
      req.isAuthenticated.mockReturnValue(true);
      req.params.taskId = '42'; // Custom parameter mapping
      
      const mockTask = { id: '42', title: 'Write tests', created_by: 2 };
      taskRepo.findById.mockResolvedValue(mockTask);
      pdpService.getEffectivePermissions.mockResolvedValue(['read:task']);

      // Configure with explicit idParamName string parameter
      const middleware = checkPerm('read:task', 'task', 'taskId');
      await middleware(req, res, next);

      expect(taskRepo.findById).toHaveBeenCalledWith('42', 1);
      expect(pdpService.getEffectivePermissions).toHaveBeenCalledWith(
        1,
        ['admin'],
        { resourceId: '42', resourceType: 'task', ownerId: 2 } // Fallbacks correctly to user_id
      );
      expect(req.task).toEqual(mockTask);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    test('should handle user with no roles', async () => {
      req.isAuthenticated.mockReturnValue(true);
      req.user.roles = [];
      pdpService.getEffectivePermissions.mockResolvedValue([]);

      const middleware = checkPerm('read:project');
      await middleware(req, res, next);

      expect(pdpService.getEffectivePermissions).toHaveBeenCalledWith(1, [], null);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should handle user with undefined roles', async () => {
      req.isAuthenticated.mockReturnValue(true);
      req.user.roles = undefined;
      pdpService.getEffectivePermissions.mockResolvedValue([]);

      const middleware = checkPerm('read:project');
      await middleware(req, res, next);

      expect(pdpService.getEffectivePermissions).toHaveBeenCalledWith(1, [], null);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});