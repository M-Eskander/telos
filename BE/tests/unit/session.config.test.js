const createSessionConfig = require('../../src/config/session.config');

describe('session configuration', () => {
  class RedisStore {
    constructor(options) {
      this.options = options;
    }
  }

  test('requires a long secret and Redis-backed sessions in production', () => {
    const redisClient = { isOpen: false, isReady: false };
    expect(() => createSessionConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'short'
    }, redisClient, RedisStore)).toThrow(/SESSION_SECRET/);
    expect(() => createSessionConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'change_this_secret'
    }, redisClient, RedisStore)).toThrow(/SESSION_SECRET/);

    const sessionConfig = createSessionConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-production-session-secret-with-more-than-32-characters'
    }, redisClient, RedisStore);
    expect(sessionConfig.store).toBeInstanceOf(RedisStore);
    expect(sessionConfig.store.options.client).toBe(redisClient);
    expect(sessionConfig.cookie.secure).toBe(true);
  });

  test('uses an explicit in-memory session store outside production', () => {
    const sessionConfig = createSessionConfig({
      NODE_ENV: 'development',
      SESSION_SECRET: 'test-session-secret'
    }, { isOpen: true, isReady: true }, RedisStore);

    expect(sessionConfig.store).toBeUndefined();
    expect(sessionConfig.secret).toBe('test-session-secret');
  });
});
