jest.mock('../../src/redis/client');

const redisClient = require('../../src/redis/client');
const startServer = require('../../src/utils/startServer');

describe('server startup', () => {
  const originalPort = process.env.PORT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PORT;
    redisClient.connect.mockResolvedValue();
  });

  afterAll(() => {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  test('connects to Redis before listening on the configured port', async () => {
    process.env.PORT = '5100';
    const listen = jest.fn();
    const app = { listen };
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await startServer(app);

    expect(redisClient.connect).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith('5100', expect.any(Function));
    listen.mock.calls[0][1]();
    expect(log).toHaveBeenCalledWith('Server burning bright on port 5100');
    log.mockRestore();
  });

  test('continues startup when Redis is unavailable', async () => {
    redisClient.connect.mockRejectedValue(new Error('connection refused'));
    const listen = jest.fn();
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await startServer({ listen });

    expect(listen).toHaveBeenCalledWith(5000, expect.any(Function));
    expect(warning).toHaveBeenCalledWith(
      'Redis not available, continuing without cache:',
      'connection refused'
    );
    warning.mockRestore();
  });

  test('reports a server startup failure and exits', async () => {
    const error = new Error('listen failed');
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    await startServer({
      listen: () => {
        throw error;
      }
    });

    expect(errorLog).toHaveBeenCalledWith('Failed to start server:', error);
    expect(exit).toHaveBeenCalledWith(1);
    errorLog.mockRestore();
    exit.mockRestore();
  });
});
