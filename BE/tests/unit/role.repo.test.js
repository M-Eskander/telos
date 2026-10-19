jest.mock('../../src/config/knex');

const knex = require('../../src/config/knex');
const roleRepo = require('../../src/repositories/role.repo');

describe('Role repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('finds a role by name', async () => {
    const role = { id: 3, name: 'reviewer' };
    const query = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(role)
    };
    knex.mockReturnValue(query);

    await expect(roleRepo.findByName('reviewer')).resolves.toBe(role);
    expect(knex).toHaveBeenCalledWith('roles');
    expect(query.where).toHaveBeenCalledWith({ name: 'reviewer' });
  });

  test('inserts a role and returns the created row', async () => {
    const role = { id: 4, name: 'editor' };
    const insert = jest.fn().mockResolvedValue([4]);
    const fetchQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(role)
    };
    const trx = jest.fn(() => ({ insert, ...fetchQuery }));

    await expect(roleRepo.insertRole('editor', trx)).resolves.toBe(role);
    expect(insert).toHaveBeenCalledWith({ name: 'editor' });
    expect(fetchQuery.where).toHaveBeenCalledWith({ name: 'editor' });
    expect(trx).toHaveBeenCalledTimes(2);
  });

  test('findOrCreate reuses an existing role or creates a missing role', async () => {
    const existing = { id: 4, name: 'editor' };
    const existingQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(existing)
    };
    const missingQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(undefined)
    };
    const insertQuery = { insert: jest.fn().mockResolvedValue([5]) };
    const createdQuery = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ id: 5, name: 'viewer' })
    };
    const trx = jest.fn()
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(missingQuery)
      .mockReturnValueOnce(insertQuery)
      .mockReturnValueOnce(createdQuery);

    await expect(roleRepo.findOrCreate('editor', trx)).resolves.toBe(existing);
    await expect(roleRepo.findOrCreate('viewer', trx)).resolves.toEqual({ id: 5, name: 'viewer' });
    expect(trx).toHaveBeenCalledTimes(4);
  });
});
