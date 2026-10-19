const redisClient = require('../redis/client');

module.exports = async function startServer(app) {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    if (!redisClient.isOpen && !redisClient.isReady) {
      try {
        await redisClient.connect();
      } catch (redisError) {
        if (isProduction) {
          throw new Error('Redis is required in production; server startup aborted', {
            cause: redisError
          });
        }
        console.warn('Redis not available, continuing with in-memory sessions:', redisError.message);
      }
    }
    if (isProduction && !redisClient.isOpen && !redisClient.isReady) {
      throw new Error('Redis is required in production; server startup aborted');
    }
    if (redisClient.isOpen || redisClient.isReady) console.log('Redis connected');

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server burning bright on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};