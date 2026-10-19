module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.js'
  ],
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 80,
      functions: 75,
      lines: 85
    }
  },
  // Load env early so modules that import at top-level can see process.env
  setupFiles: ['<rootDir>/tests/envSetup.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000
};