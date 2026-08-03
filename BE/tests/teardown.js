const redisClient = require('../src/redis/client');

module.exports = async () => {
  if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
    try {
      await redisClient.quit();
    } catch (err) {
      // Ignore errors during test cleanup
    }
  }
};
