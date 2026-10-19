jest.mock('../../src/config/knex');

const knex = require('../../src/config/knex');
const userRepo = require('../../src/repositories/user.repo');

describe('User repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('looks up a user by email', async () => {
    const user = { id: 8, email: 'person@example.com' };
    const query = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(user)
    };
    knex.mockReturnValue(query);

    await expect(userRepo.findByEmail('person@example.com')).resolves.toBe(user);
    expect(knex).toHaveBeenCalledWith('users');
    expect(query.where).toHaveBeenCalledWith({ email: 'person@example.com' });
  });

  test('looks up a user by id using the supplied transaction', async () => {
    const user = { id: 8 };
    const query = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(user)
    };
    const trx = jest.fn().mockReturnValue(query);

    await expect(userRepo.findById(8, trx)).resolves.toBe(user);
    expect(trx).toHaveBeenCalledWith('users');
    expect(query.where).toHaveBeenCalledWith({ id: 8 });
  });

  test('inserts a user through the selected database and returns the inserted row', async () => {
    const user = { email: 'person@example.com', name: 'Person' };
    const insert = jest.fn().mockResolvedValue([8]);
    const query = {
      insert,
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ id: 8, ...user })
    };
    const trx = jest.fn().mockReturnValue(query);

    await expect(userRepo.insertUser(user, trx)).resolves.toEqual({ id: 8, ...user });
    expect(insert).toHaveBeenCalledWith(user);
    expect(trx).toHaveBeenCalledTimes(2);
    expect(query.where).toHaveBeenCalledWith({ email: user.email });
  });
});
