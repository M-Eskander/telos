// Early test environment setup: load env vars before modules are required
require('dotenv').config();
const path = require('path');

// Basic env defaults for tests
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test_session_secret';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.CONTRACT_STORAGE_DIR = path.resolve(__dirname, '../.test-contract-storage');

// If using the real Redis instance (e.g. Docker container started with
// `--requirepass password`), provide the password here for tests. This
// runs early so modules that initialize at import time can see the password.
if (process.env.USE_REAL_REDIS && process.env.USE_REAL_REDIS === 'true') {
  process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'password';
}

// Mark that dotenv has been loaded to avoid later overrides by other modules
process.env.__DOTENV_LOADED = 'true';

// Export nothing; this file exists to mutate process.env early for Jest
