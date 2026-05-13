// Global test setup
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test_session_secret';

// Mock Redis for all tests
jest.mock('../src/redis/client', () => ({
  get: jest.fn(),
  setEx: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
  quit: jest.fn()
}));

// Mock bcrypt for consistent hashing in tests
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$testHashedPassword'),
  compare: jest.fn().mockImplementation((plain, hash) => {
    return Promise.resolve(plain === 'password' && hash === '$2a$10$hashedpassword');
  })
}));