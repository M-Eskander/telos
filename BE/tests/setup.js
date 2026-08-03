// Global test setup
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test_session_secret';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

// If using the real Redis instance (e.g. Docker container started with
// `--requirepass password`), provide the password here for tests.
if (process.env.USE_REAL_REDIS && process.env.USE_REAL_REDIS === 'true') {
  // NOTE: change this if your container uses a different password
  process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'password';
}

// Allow opting into using a real Redis instance for integration tests by
// setting the environment variable `USE_REAL_REDIS=true` when running Jest.
// Default behavior remains: mock Redis for fast, hermetic unit tests.
if (!process.env.USE_REAL_REDIS || process.env.USE_REAL_REDIS !== 'true') {
  // Mock Redis for all tests with comprehensive interface
  jest.mock('../src/redis/client', () => ({
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(0),
    keys: jest.fn().mockResolvedValue([]),
    connect: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(),
    isOpen: false,  // Disable Redis in tests
    isReady: false
  }));

  // Mock RedisStore from connect-redis (both default and named export)
  jest.mock('connect-redis', () => {
    const RedisStoreMock = jest.fn().mockImplementation(() => ({
      get: jest.fn((sid, cb) => cb(null, null)),
      set: jest.fn((sid, sess, cb) => cb(null)),
      destroy: jest.fn((sid, cb) => cb(null))
    }));
    
    // Support both default and .default import
    RedisStoreMock.default = RedisStoreMock;
    return RedisStoreMock;
  });
}

// Mock bcrypt for consistent hashing in tests
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$testHashedPassword'),
  compare: jest.fn().mockImplementation((plain, hash) => {
    return Promise.resolve(plain === 'password' && hash === '$2a$10$hashedpassword');
  })
}));

const redisClient = require('../src/redis/client');

afterAll(async () => {
  if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
    try {
      await redisClient.quit();
    } catch (err) {
      // Ignore errors during test cleanup
    }
  }
});