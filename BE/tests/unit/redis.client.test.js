jest.unmock('../../src/redis/client');

const mockClient = {
  on: jest.fn().mockReturnThis(),
  connect: jest.fn().mockResolvedValue(),
  quit: jest.fn().mockResolvedValue()
};
let mockedCreateClient;
jest.mock('redis', () => {
  mockedCreateClient = jest.fn(() => mockClient);
  return { createClient: mockedCreateClient };
});

describe('Redis client configuration', () => {
  const originalEnv = {};
  const envKeys = [
    'REDIS_URL',
    'REDIS_PASSWORD',
    'REDIS_HOST',
    'REDIS_PORT',
    'USE_REAL_REDIS',
    'NODE_ENV'
  ];

  beforeAll(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    for (const key of envKeys) delete process.env[key];
    process.env.NODE_ENV = 'test';
    mockClient.on.mockReturnThis();
    mockClient.connect.mockResolvedValue();
  });

  afterAll(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  function loadClient() {
    let client;
    jest.isolateModules(() => {
      client = require('../../src/redis/client');
    });
    return client;
  }

  test('uses host and port settings and registers lifecycle listeners', () => {
    process.env.REDIS_HOST = 'cache.internal';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'secret';

    expect(loadClient()).toBe(mockClient);
    const config = mockedCreateClient.mock.calls[0][0];
    expect(config).toMatchObject({
      host: 'cache.internal',
      port: '6380',
      password: 'secret',
      socket: { reconnectStrategy: expect.any(Function) }
    });
    expect(config.socket.reconnectStrategy(3)).toBe(150);
    expect(mockClient.on.mock.calls.map(([event]) => event)).toEqual([
      'connect',
      'ready',
      'error',
      'end'
    ]);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  test('prefers REDIS_URL and adds a configured password when the URL omits it', () => {
    process.env.REDIS_URL = 'redis://cache.internal:6379';
    process.env.REDIS_PASSWORD = 'pass@word';
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    loadClient();

    expect(decodeURIComponent(new URL(process.env.REDIS_URL).password)).toBe('pass@word');
    expect(mockedCreateClient).toHaveBeenCalledWith({
      url: process.env.REDIS_URL,
      password: 'pass@word'
    });
    expect(log).toHaveBeenCalledWith(
      'Injected password into REDIS_URL for authenticated connection'
    );
    log.mockRestore();
  });

  test('does not overwrite a password already embedded in REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://existing:embedded@cache.internal:6379';
    process.env.REDIS_PASSWORD = 'separate-secret';

    loadClient();

    expect(process.env.REDIS_URL).toBe('redis://existing:embedded@cache.internal:6379');
    expect(mockedCreateClient).toHaveBeenCalledWith({
      url: process.env.REDIS_URL,
      password: 'separate-secret'
    });
  });

  test('uses the real-Redis test fallback password when none is configured', () => {
    process.env.USE_REAL_REDIS = 'true';

    loadClient();

    expect(mockedCreateClient.mock.calls[0][0].password).toBe('password');
  });

  test('continues module initialization and logs when the initial connection fails', async () => {
    const error = new Error('connection refused');
    mockClient.connect.mockRejectedValue(error);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadClient()).toBe(mockClient);
    await Promise.resolve();
    await Promise.resolve();

    expect(errorLog).toHaveBeenCalledWith('Failed to connect to Redis:', 'connection refused');
    expect(warning).toHaveBeenCalledWith(
      'Sessions will use in-memory store (development mode)'
    );
    errorLog.mockRestore();
    warning.mockRestore();
  });

  test('closes Redis and exits on SIGINT outside the test environment', async () => {
    process.env.NODE_ENV = 'development';
    let shutdown;
    const on = jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'SIGINT') shutdown = listener;
      return process;
    });
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});

    loadClient();
    await shutdown();

    expect(on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(mockClient.quit).toHaveBeenCalled();
    expect(exit).toHaveBeenCalled();
    on.mockRestore();
    exit.mockRestore();
  });

  test('logs Redis shutdown errors and still exits on SIGINT', async () => {
    process.env.NODE_ENV = 'production';
    mockClient.quit.mockRejectedValue(new Error('quit failed'));
    let shutdown;
    jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'SIGINT') shutdown = listener;
      return process;
    });
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    loadClient();
    await shutdown();

    expect(errorLog).toHaveBeenCalledWith(
      'Error closing Redis connection:',
      expect.objectContaining({ message: 'quit failed' })
    );
    expect(exit).toHaveBeenCalled();
    process.on.mockRestore();
    exit.mockRestore();
    errorLog.mockRestore();
  });
});
