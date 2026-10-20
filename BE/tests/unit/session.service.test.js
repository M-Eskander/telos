const redisClient = require('../../src/redis/client');
const sessionService = require('../../src/services/session.service');

describe('session service', () => {
  beforeEach(() => {
    redisClient.keys.mockReset().mockResolvedValue([]);
    redisClient.get.mockReset().mockResolvedValue(null);
    redisClient.del.mockReset().mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('deletes the user sessions but keeps the request that is changing the password', async () => {
    redisClient.keys.mockResolvedValueOnce([
      'sess:current',
      'sess:other',
      'sess:someone-else',
      'sess:broken'
    ]);
    redisClient.get
      .mockResolvedValueOnce(JSON.stringify({ passport: { user: 7 } }))
      .mockResolvedValueOnce(JSON.stringify({ passport: { user: 9 } }))
      .mockResolvedValueOnce('not-json');
    redisClient.del.mockResolvedValueOnce(1);

    const removed = await sessionService.invalidateUserSessions(7, 'current');

    expect(removed).toBe(1);
    expect(redisClient.del).toHaveBeenCalledTimes(1);
    expect(redisClient.del).toHaveBeenCalledWith('sess:other');
  });

  test('deletes every session for the user when no exception is given', async () => {
    redisClient.keys.mockResolvedValueOnce(['sess:a', 'sess:b']);
    redisClient.get
      .mockResolvedValueOnce(JSON.stringify({ passport: { user: 7 } }))
      .mockResolvedValueOnce(JSON.stringify({ passport: { user: '7' } }));
    redisClient.del.mockResolvedValueOnce(1);

    const removed = await sessionService.invalidateUserSessions(7);

    expect(removed).toBe(2);
    expect(redisClient.del).toHaveBeenCalledTimes(2);
  });

  test('is non-fatal when Redis cannot list sessions', async () => {
    redisClient.keys.mockRejectedValueOnce(new Error('redis down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sessionService.invalidateUserSessions(7)).resolves.toBe(0);
  });

  test('ignores calls without a user id', async () => {
    await expect(sessionService.invalidateUserSessions(null)).resolves.toBe(0);
    expect(redisClient.keys).not.toHaveBeenCalled();
  });
});
