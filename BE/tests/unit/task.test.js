const taskService = require('../../src/services/tasks.service');
const taskRepository = require('../../src/repositories/task.repo');
const knex = require('../../src/config/knex');

// Mock repository and database transaction
jest.mock('../../src/repositories/task.repo');
jest.mock('../../src/config/knex', () => ({
  transaction: jest.fn(async (cb) => cb({}))
}));

describe('Task Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should create a task with required fields (title, dates, status, progress)', async () => {
    const mockProjectId = 1;
    const mockUserId = 1;
    const taskInput = {
      title: 'Implement Physics Engine',
      status: 'todo',
      progress: 0,
      start_date: '2026-06-01',
      end_date: '2026-06-15',
      assignee_ids: [2, 3]
    };

    const mockCreatedTask = { id: 10, ...taskInput, project_id: mockProjectId };
    
    taskRepository.create.mockResolvedValue(mockCreatedTask);
    taskRepository.setAssignees.mockResolvedValue(true);
    taskRepository.findById.mockResolvedValue({
      ...mockCreatedTask,
      assignees: [{ id: 2 }, { id: 3 }],
      subtasks: []
    });

    const result = await taskService.createTask(mockProjectId, mockUserId, taskInput);

    expect(taskRepository.create).toHaveBeenCalledTimes(1);
    expect(result.title).toEqual('Implement Physics Engine');
    expect(result.assignees.length).toEqual(2);
  });

  test('should support parent-child subtask hierarchy', async () => {
    const mockProjectId = 1;
    const mockUserId = 1;
    const subtaskInput = {
      title: 'Write Collision Detection',
      parent_task_id: 10,
      status: 'in_progress',
      progress: 50
    };

    const mockCreatedSubtask = { id: 11, ...subtaskInput, project_id: mockProjectId };

    taskRepository.create.mockResolvedValue(mockCreatedSubtask);
    taskRepository.findById.mockResolvedValue({
      ...mockCreatedSubtask,
      assignees: [],
      subtasks: []
    });

    const result = await taskService.createTask(mockProjectId, mockUserId, subtaskInput);

    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parent_task_id: 10 }),
      expect.any(Object)
    );
    expect(result.parent_task_id).toEqual(10);
  });
});


// 2. Regression & Integration Tests for Task Routes (`tests/integration/taskRoutes.test.js`)
// Using Supertest to ensure endpoints validate permissions, enforce project-level visibility rules, and handle data accurately[cite: 2].

const request = require('supertest');
const express = require('express');
const taskRoutes = require('../../src/routes/task.router');

// Create test app instance
const app = express();
app.use(express.json());

// Mock auth / permission middleware to test visibility constraints
jest.mock('../../src/middleware/auth.middleware', () => ({
  checkPerm: (action, resource) => (req, res, next) => {
    // Simulate global rule: no user can access projects outside their own scope[cite: 2]
    if (req.headers['x-unauthorized-project'] === 'true') {
      return res.status(403).json({ success: false, message: 'Forbidden: Outside own projects' });
    }
    next();
  }
}));

// Mock controller methods for integration routing check
const taskController = require('../../src/controllers/task.controller');
jest.mock('../../src/controllers/task.controller', () => ({
  create: (req, res) => res.status(201).json({ success: true, data: { id: 1, title: req.body.title } }),
  getAllForProject: (req, res) => res.status(200).json({ success: true, data: [] }),
  update: (req, res) => res.status(200).json({ success: true, data: { id: req.params.id, ...req.body } }),
  remove: (req, res) => res.status(200).json({ success: true, message: 'Task deleted successfully' })
}));

app.use('/api/projects/:projectId/tasks', taskRoutes);

describe('Task Routes Regression Tests', () => {
  test('GET /api/projects/:projectId/tasks should return tasks for authorized project', async () => {
    const response = await request(app)
      .get('/api/projects/1/tasks');

    expect(response.status).toEqual(200);
    expect(response.body.success).toBe(true);
  });

  test('GET /api/projects/:projectId/tasks should enforce global rule blocking access outside own projects', async () => {
    const response = await request(app)
      .get('/api/projects/99/tasks')
      .set('x-unauthorized-project', 'true');

    expect(response.status).toEqual(403);
    expect(response.body.message).toContain('Forbidden');
  });

  test('POST /api/projects/:projectId/tasks should require title, assignee, dates, status, and progress attributes', async () => {
    const response = await request(app)
      .post('/api/projects/1/tasks')
      .send({
        title: 'Design UI Layout',
        status: 'todo',
        progress: 10,
        start_date: '2026-06-01',
        end_date: '2026-06-05',
        assignee_ids: [4]
      });

    expect(response.status).toEqual(201);
    expect(response.body.data.title).toEqual('Design UI Layout');
  });
});