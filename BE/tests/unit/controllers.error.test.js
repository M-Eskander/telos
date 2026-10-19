jest.mock('../../src/services/project.service');
jest.mock('../../src/services/tasks.service');
jest.mock('../../src/services/pdp.service');

const projectService = require('../../src/services/project.service');
const taskService = require('../../src/services/tasks.service');
const pdpService = require('../../src/services/pdp.service');
const projectController = require('../../src/controllers/project.controller');
const taskController = require('../../src/controllers/task.controller');

describe('Project and task controller error propagation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const projectCases = [
    ['listProjects', { user: { id: 1, roles: [] } }, 'listProjects'],
    ['createProject', { user: { id: 1 }, body: { name: 'Project' } }, 'createProject'],
    ['getProjectById', { params: { id: '1' } }, 'getProjectById'],
    ['updateProject', { params: { id: '1' }, body: {} }, 'updateProject'],
    ['deleteProject', { params: { id: '1' } }, 'deleteProject']
  ];

  test.each(projectCases)('%s passes service errors to Express', async (
    handlerName,
    req,
    serviceMethod
  ) => {
    const error = new Error('project persistence failed');
    projectService[serviceMethod].mockRejectedValue(error);
    const next = jest.fn();
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await projectController[handlerName](req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('listProjects forwards permission-evaluation failures', async () => {
    projectService.listProjects.mockResolvedValue([{ id: 2, created_by: 3 }]);
    const error = new Error('permission lookup failed');
    pdpService.getEffectivePermissions.mockRejectedValue(error);
    const next = jest.fn();

    await projectController.listProjects(
      { user: { id: 1, roles: [] } },
      { json: jest.fn() },
      next
    );

    expect(next).toHaveBeenCalledWith(error);
  });

  const taskCases = [
    ['create', { params: { projectId: '1' }, user: { id: 2 }, body: {} }, 'createTask'],
    ['getAllForProject', { params: { projectId: '1' } }, 'getProjectTasks'],
    ['update', { params: { projectId: '1', id: '2' }, body: {} }, 'updateTask'],
    ['remove', { params: { projectId: '1', id: '2' } }, 'deleteTask']
  ];

  test.each(taskCases)('%s passes unexpected service errors to Express', async (
    handlerName,
    req,
    serviceMethod
  ) => {
    const error = new Error('task persistence failed');
    taskService[serviceMethod].mockRejectedValue(error);
    const next = jest.fn();
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await taskController[handlerName](req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
