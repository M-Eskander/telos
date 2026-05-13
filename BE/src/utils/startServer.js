const redisClient = require('../redis/client');

module.exports = async function startServer(app) {
  try {
    // Try to connect to Redis, but don't fail if unavailable
    try {
      await redisClient.connect();
      console.log('✅ Redis connected');
    } catch (redisErr) {
      console.warn('⚠️ Redis not available, continuing without cache:', redisErr.message);
    }

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🔥 Server burning bright on port ${PORT}`);
    });
  } catch (err) {
    console.error('🛑 Failed to start server:', err);
    process.exit(1);
  }
};