jest.mock('../../src/config/knex');

const knex = require('../../src/config/knex');
const projectRepo = require('../../src/repositories/project.repo');

describe('Project repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('finds projects by name and optionally scopes lookup to the creator', async () => {
    const project = { id: 4, name: 'Planning' };
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(project)
    };
    knex.mockReturnValue(query);

    await expect(projectRepo.getProjectByName('Planning')).resolves.toBe(project);
    expect(query.where).toHaveBeenCalledWith({ name: 'Planning' });

    await expect(projectRepo.getProjectById(4, 7)).resolves.toBe(project);
    expect(query.where).toHaveBeenCalledWith({ id: 4 });
    expect(query.andWhere).toHaveBeenCalledWith({ created_by: 7 });
  });

  test('inserts through a transaction and fetches the inserted project', async () => {
    const project = { id: 4, name: 'Planning' };
    const insertQuery = { insert: jest.fn().mockResolvedValue([4]) };
    const fetchQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(project)
    };
    const trx = jest.fn()
      .mockReturnValueOnce(insertQuery)
      .mockReturnValueOnce(fetchQuery);

    await expect(projectRepo.insertProject('Planning', 'Roadmap', 7, trx)).resolves.toBe(project);
    expect(insertQuery.insert).toHaveBeenCalledWith({
      name: 'Planning',
      description: 'Roadmap',
      created_by: 7
    });
    expect(fetchQuery.where).toHaveBeenCalledWith({ id: 4 });
  });

  test('findOrCreate preserves an existing project or inserts a missing one', async () => {
    const existing = { id: 4, name: 'Planning' };
    const existingQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(existing)
    };
    const missingQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(undefined)
    };
    const insertQuery = { insert: jest.fn().mockResolvedValue(5) };
    const fetchQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ id: 5, name: 'Delivery' })
    };
    const trx = jest.fn()
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(missingQuery)
      .mockReturnValueOnce(insertQuery)
      .mockReturnValueOnce(fetchQuery);

    await expect(projectRepo.findOrCreate('Planning', 'Ignored', 7, trx)).resolves.toBe(existing);
    await expect(projectRepo.findOrCreate('Delivery', 'Roadmap', 7, trx))
      .resolves.toEqual({ id: 5, name: 'Delivery' });
    expect(insertQuery.insert).toHaveBeenCalledWith({
      name: 'Delivery',
      description: 'Roadmap',
      created_by: 7
    });
  });

  test('lists projects globally or by creator', async () => {
    const select = jest.fn().mockResolvedValue([{ id: 1 }]);
    const query = {
      where: jest.fn().mockReturnThis(),
      select
    };
    knex.mockReturnValue(query);

    await expect(projectRepo.listProjects(7)).resolves.toEqual([{ id: 1 }]);
    expect(query.where).toHaveBeenCalledWith({ created_by: 7 });
    expect(select).toHaveBeenCalledWith('*');

    await projectRepo.listProjects();
    expect(query.where).toHaveBeenCalledTimes(1);
  });

  test('deletes and updates projects with optional creator restrictions', async () => {
    const del = jest.fn().mockResolvedValue(1);
    const update = jest.fn().mockResolvedValue(1);
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      del,
      update
    };
    knex.mockReturnValue(query);

    await expect(projectRepo.deleteProject(4, 7)).resolves.toBe(1);
    expect(query.where).toHaveBeenCalledWith({ id: 4 });
    expect(query.andWhere).toHaveBeenCalledWith({ created_by: 7 });
    expect(del).toHaveBeenCalled();

    await expect(projectRepo.updateProject(4, 7, { name: 'Renamed', description: undefined }))
      .resolves.toBe(1);
    expect(update).toHaveBeenCalledWith({ name: 'Renamed' });
    expect(query.andWhere).toHaveBeenCalledTimes(2);

    await projectRepo.updateProject(4, null, {});
    expect(update).toHaveBeenLastCalledWith({});
  });
});
