const taskService = require('../../src/services/tasks.service');
const taskRepository = require('../../src/repositories/task.repo');
const knex = require('../../src/config/knex');

jest.mock('../../src/repositories/task.repo');
jest.mock('../../src/config/knex', () => ({
  transaction: jest.fn()
}));

function createDatabase(seed = {}) {
  const database = {
    tasks: (seed.tasks || []).map(task => ({ ...task })),
    task_assignment: (seed.task_assignment || []).map(assignment => ({ ...assignment })),
    projects: (seed.projects || []).map(project => ({ ...project }))
  };
  const queryCalls = [];

  const trx = jest.fn(tableName => {
    const filters = [];
    const rows = () => (database[tableName] || []).filter(row =>
      filters.every(([key, value]) => row[key] === value)
    );
    const query = {
      where: (key, value) => {
        const condition = typeof key === 'string' ? { [key]: value } : key;
        Object.entries(condition).forEach(entry => filters.push(entry));
        return query;
      },
      first: async () => {
        const row = rows()[0];
        return row ? { ...row } : undefined;
      },
      select: async () => rows().map(row => ({ ...row })),
      insert: async input => {
        const inserted = (Array.isArray(input) ? input : [input]).map(record => {
          const row = { ...record };
          if (tableName === 'tasks' && row.id === undefined) {
            row.id = database[tableName].reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
          }
          database[tableName].push(row);
          return row;
        });
        return [inserted[0].id];
      },
      update: async updates => {
        queryCalls.push({ tableName, action: 'update', filters: [...filters], updates });
        rows().forEach(row => Object.assign(row, updates));
        return rows().length;
      },
      del: async () => {
        queryCalls.push({ tableName, action: 'delete', filters: [...filters] });
        const matching = new Set(rows());
        database[tableName] = database[tableName].filter(row => !matching.has(row));
        return matching.size;
      },
      then: (resolve, reject) => Promise.resolve(rows().map(row => ({ ...row }))).then(resolve, reject)
    };
    return query;
  });

  return { database, queryCalls, trx };
}

function useTransaction(seed) {
  const db = createDatabase(seed);
  knex.transaction.mockImplementation(callback => callback(db.trx));
  return db;
}

describe('Task Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    test('creates a root task with task fields and assignees, then recalculates project progress', async () => {
      const { database, queryCalls } = useTransaction({
        tasks: [{ id: 3, project_id: 1, parent_task_id: null, progress: 100, weight: 1 }],
        projects: [{ id: 1, progress: 0 }]
      });
      const createdTask = {
        id: 4,
        project_id: 1,
        parent_task_id: null,
        title: 'Implement Physics Engine',
        progress: 0,
        weight: 3
      };
      taskRepository.findById.mockResolvedValue(createdTask);

      const result = await taskService.createTask(1, 7, {
        title: 'Implement Physics Engine',
        description: 'Build the simulation core',
        status: 'in_progress',
        priority: 'high',
        progress: 0,
        weight: 3,
        start_date: '2026-06-01',
        end_date: '2026-06-15',
        assignee_ids: [2, 5]
      });

      expect(result).toEqual(createdTask);
      expect(database.tasks[1]).toMatchObject({
        id: 4,
        project_id: 1,
        created_by: 7,
        title: 'Implement Physics Engine',
        description: 'Build the simulation core',
        status: 'in_progress',
        priority: 'high',
        parent_task_id: null,
        progress: 0,
        weight: 3,
        start_date: '2026-06-01',
        end_date: '2026-06-15'
      });
      expect(database.task_assignment).toEqual([
        { task_id: 4, user_id: 2 },
        { task_id: 4, user_id: 5 }
      ]);
      expect(database.projects[0].progress).toBe(25);
      expect(queryCalls).toContainEqual({
        tableName: 'projects',
        action: 'update',
        filters: [['id', 1]],
        updates: { progress: 25 }
      });
      expect(taskRepository.findById).toHaveBeenCalledWith(4);
    });

    test('uses defaults and skips assignee insertion when fields are omitted', async () => {
      const { database } = useTransaction({ projects: [{ id: 2, progress: 100 }] });
      taskRepository.findById.mockResolvedValue({ id: 1, title: 'Task' });

      await taskService.createTask(2, 9, { title: 'Task' });

      expect(database.tasks[0]).toMatchObject({
        project_id: 2,
        created_by: 9,
        title: 'Task',
        description: null,
        status: 'todo',
        priority: 'medium',
        parent_task_id: null,
        progress: 0,
        weight: 1,
        start_date: null,
        end_date: null
      });
      expect(database.task_assignment).toEqual([]);
      expect(database.projects[0].progress).toBe(0);
    });

    test('recalculates parent and project progress when creating a subtask', async () => {
      const { database } = useTransaction({
        tasks: [
          { id: 1, project_id: 3, parent_task_id: null, progress: 10, weight: 1 },
          { id: 2, project_id: 3, parent_task_id: 1, progress: 0, weight: 1 }
        ],
        projects: [{ id: 3, progress: 0 }]
      });
      taskRepository.findById.mockResolvedValue({ id: 3, parent_task_id: 1 });

      await taskService.createTask(3, 9, {
        title: 'Subtask',
        parent_task_id: 1,
        progress: 100,
        weight: 3
      });

      expect(database.tasks.find(task => task.id === 1).progress).toBe(75);
      expect(database.projects[0].progress).toBe(75);
    });
  });

  describe('getProjectTasks', () => {
    test('returns the repository tasks for the requested project', async () => {
      const projectTasks = [{ id: 1, title: 'Task', subtasks: [] }];
      taskRepository.findByProject.mockResolvedValue(projectTasks);

      await expect(taskService.getProjectTasks(5)).resolves.toBe(projectTasks);
      expect(taskRepository.findByProject).toHaveBeenCalledWith(5);
    });
  });

  describe('updateTask', () => {
    test('updates allowed fields, replaces assignees, and recalculates project progress', async () => {
      const { database, queryCalls } = useTransaction({
        tasks: [{
          id: 1,
          project_id: 4,
          parent_task_id: null,
          title: 'Old',
          status: 'todo',
          priority: 'medium',
          progress: 0,
          weight: 1
        }],
        task_assignment: [{ task_id: 1, user_id: 2 }],
        projects: [{ id: 4, progress: 0 }]
      });
      taskRepository.findById.mockResolvedValue({ id: 1, title: 'Updated' });

      const result = await taskService.updateTask(1, {
        title: 'Updated',
        status: 'done',
        progress: 80,
        weight: 2,
        description: 'Finished',
        start_date: '2026-06-01',
        end_date: '2026-06-02',
        assignee_ids: [3, 4],
        project_id: 99,
        created_by: 77
      });

      expect(result).toEqual({ id: 1, title: 'Updated' });
      expect(database.tasks[0]).toMatchObject({
        title: 'Updated',
        status: 'done',
        progress: 80,
        weight: 2,
        description: 'Finished',
        start_date: '2026-06-01',
        end_date: '2026-06-02',
        project_id: 4
      });
      expect(database.task_assignment).toEqual([
        { task_id: 1, user_id: 3 },
        { task_id: 1, user_id: 4 }
      ]);
      expect(database.projects[0].progress).toBe(80);
      expect(queryCalls).toContainEqual(expect.objectContaining({
        tableName: 'tasks',
        action: 'update',
        filters: [['id', 1]],
        updates: expect.not.objectContaining({ project_id: 99, created_by: 77 })
      }));
      expect(taskRepository.findById).toHaveBeenCalledWith(1);
    });

    test('supports clearing assignees and leaves task fields unchanged for an empty update', async () => {
      const { database, queryCalls } = useTransaction({
        tasks: [{
          id: 1, project_id: 4, parent_task_id: null, title: 'Keep', progress: 30, weight: 1
        }],
        task_assignment: [{ task_id: 1, user_id: 2 }],
        projects: [{ id: 4, progress: 0 }]
      });
      taskRepository.findById.mockResolvedValue({ id: 1, title: 'Keep' });

      await taskService.updateTask(1, { assignee_ids: [] });

      expect(database.tasks[0].title).toBe('Keep');
      expect(database.task_assignment).toEqual([]);
      expect(queryCalls.filter(call => call.tableName === 'tasks' && call.action === 'update')).toEqual([]);
      expect(database.projects[0].progress).toBe(30);
    });

    test('throws when the task does not exist', async () => {
      useTransaction();

      await expect(taskService.updateTask(404, { title: 'Missing' })).rejects.toThrow('Task not found');
      expect(taskRepository.findById).not.toHaveBeenCalled();
    });

    test('recalculates ancestors when updating a nested subtask', async () => {
      const { database, trx } = useTransaction({
        tasks: [
          { id: 1, project_id: 6, parent_task_id: null, progress: 0, weight: 1 },
          { id: 2, project_id: 6, parent_task_id: 1, progress: 0, weight: 1 },
          { id: 3, project_id: 6, parent_task_id: 2, progress: 0, weight: 1 }
        ],
        projects: [{ id: 6, progress: 0 }]
      });
      taskRepository.findById.mockResolvedValue({ id: 3, progress: 100 });

      await taskService.updateTask(3, { progress: 100 });

      expect(database.tasks.find(task => task.id === 2).progress).toBe(100);
      expect(database.tasks.find(task => task.id === 1).progress).toBe(100);
      expect(database.projects[0].progress).toBe(100);
    });
  });

  describe('deleteTask', () => {
    test('delegates task deletion to the repository and returns its result', async () => {
      taskRepository.remove.mockResolvedValue(1);

      await expect(taskService.deleteTask(12)).resolves.toBe(1);
      expect(taskRepository.remove).toHaveBeenCalledWith(12);
    });
  });

  describe('progress calculations', () => {
    test('calculates weighted parent progress and updates the root project', async () => {
      const { database, trx } = useTransaction({
        tasks: [
          { id: 1, project_id: 8, parent_task_id: null, progress: 0, weight: 1 },
          { id: 2, project_id: 8, parent_task_id: 1, progress: 20, weight: 1 },
          { id: 3, project_id: 8, parent_task_id: 1, progress: 80, weight: 3 }
        ],
        projects: [{ id: 8, progress: 0 }]
      });

      await taskService.recalculateParentProgress(1, trx);

      expect(database.tasks.find(task => task.id === 1).progress).toBe(65);
      expect(database.projects[0].progress).toBe(65);
    });

    test('defaults zero or null weights to one and null progress to zero', async () => {
      const { database, trx } = useTransaction({
        tasks: [
          { id: 1, project_id: 11, parent_task_id: null, progress: 0, weight: 0 },
          { id: 2, project_id: 11, parent_task_id: 1, progress: 0, weight: 0 },
          { id: 3, project_id: 11, parent_task_id: 1, progress: 100, weight: null },
          { id: 4, project_id: 11, parent_task_id: null, progress: null, weight: 1 }
        ],
        projects: [{ id: 11, progress: 0 }]
      });

      await taskService.recalculateParentProgress(1, trx);

      expect(database.tasks.find(task => task.id === 1).progress).toBe(50);
      expect(database.projects[0].progress).toBe(25);
    });

    test('returns zero when positive and negative weights cancel out', async () => {
      const { database, trx } = useTransaction({
        tasks: [
          { id: 1, project_id: 13, parent_task_id: null, progress: 50, weight: 1 },
          { id: 2, project_id: 13, parent_task_id: 1, progress: 25, weight: 1 },
          { id: 3, project_id: 13, parent_task_id: 1, progress: 75, weight: -1 },
          { id: 4, project_id: 13, parent_task_id: null, progress: 80, weight: -1 }
        ],
        projects: [{ id: 13, progress: 10 }]
      });

      await taskService.recalculateParentProgress(1, trx);

      expect(database.tasks.find(task => task.id === 1).progress).toBe(0);
      expect(database.projects[0].progress).toBe(0);
    });

    test('rounds weighted progress to the nearest whole number', async () => {
      const { database, trx } = useTransaction({
        tasks: [
          { id: 1, project_id: 14, parent_task_id: null, progress: 0, weight: 1 },
          { id: 2, project_id: 14, parent_task_id: 1, progress: 50, weight: 1 },
          { id: 3, project_id: 14, parent_task_id: 1, progress: 51, weight: 1 }
        ],
        projects: [{ id: 14, progress: 0 }]
      });

      await taskService.recalculateParentProgress(1, trx);

      expect(database.tasks.find(task => task.id === 1).progress).toBe(51);
      expect(database.projects[0].progress).toBe(51);
    });

    test('does nothing for a missing parent id or a parent with no subtasks', async () => {
      const { database, queryCalls, trx } = useTransaction({
        tasks: [{ id: 1, project_id: 8, parent_task_id: null, progress: 20, weight: 1 }]
      });

      await taskService.recalculateParentProgress(null, trx);
      await taskService.recalculateParentProgress(1, trx);

      expect(database.tasks[0].progress).toBe(20);
      expect(queryCalls).toEqual([]);
    });

    test('does not update project progress when the parent task record is missing', async () => {
      const { database, trx } = useTransaction({
        tasks: [{ id: 2, project_id: 12, parent_task_id: 1, progress: 50, weight: 1 }],
        projects: [{ id: 12, progress: 75 }]
      });

      await taskService.recalculateParentProgress(1, trx);

      expect(database.tasks[0].progress).toBe(50);
      expect(database.projects[0].progress).toBe(75);
    });

    test('calculates weighted project progress using only root tasks', async () => {
      const { database, trx } = useTransaction({
        tasks: [
          { id: 1, project_id: 9, parent_task_id: null, progress: 20, weight: 1 },
          { id: 2, project_id: 9, parent_task_id: null, progress: 80, weight: 3 },
          { id: 3, project_id: 9, parent_task_id: 1, progress: 100, weight: 10 },
          { id: 4, project_id: 10, parent_task_id: null, progress: 100, weight: 10 }
        ],
        projects: [{ id: 9, progress: 0 }]
      });

      await taskService.recalculateProjectProgress(9, trx);

      expect(database.projects[0].progress).toBe(65);
    });

    test('resets project progress when the project has no root tasks', async () => {
      const { database, trx } = useTransaction({
        tasks: [{ id: 1, project_id: 10, parent_task_id: 5, progress: 50, weight: 1 }],
        projects: [{ id: 10, progress: 90 }]
      });

      await taskService.recalculateProjectProgress(10, trx);

      expect(database.projects[0].progress).toBe(0);
    });
  });
});

const request = require('supertest');
const express = require('express');
const taskRoutes = require('../../src/routes/task.router');

const app = express();
app.use(express.json());

jest.mock('../../src/middleware/auth.middleware', () => ({
  checkPerm: (action, resource) => (req, res, next) => {
    if (req.headers['x-unauthorized-project'] === 'true') {
      return res.status(403).json({ success: false, message: 'Forbidden: Outside own projects' });
    }
    next();
  }
}));

jest.mock('../../src/controllers/task.controller', () => ({
  create: (req, res) => res.status(201).json({ success: true, data: { id: 1, title: req.body.title } }),
  getAllForProject: (req, res) => res.status(200).json({ success: true, data: [] }),
  update: (req, res) => res.status(200).json({ success: true, data: { id: req.params.id, ...req.body } }),
  remove: (req, res) => res.status(200).json({ success: true, message: 'Task deleted successfully' })
}));

app.use('/api/projects/:projectId/tasks', taskRoutes);

describe('Task Routes Regression Tests', () => {
  test('GET returns tasks for an authorized project', async () => {
    const response = await request(app).get('/api/projects/1/tasks');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('GET blocks access outside the authorized project scope', async () => {
    const response = await request(app)
      .get('/api/projects/99/tasks')
      .set('x-unauthorized-project', 'true');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Forbidden');
  });

  test('POST forwards task input to the create controller', async () => {
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

    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe('Design UI Layout');
  });
});
