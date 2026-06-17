const { createClient } = require('redis');

// Initialize the client
// Supports both legacy REDIS_URL and separate REDIS_HOST/REDIS_PORT
const redisConfig = process.env.REDIS_URL 
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      }
    };

const client = createClient(redisConfig);

// Event listeners for production monitoring
client.on('connect', () => console.log('Redis: Connected'));
client.on('ready', () => console.log('Redis: Ready to use'));
client.on('error', (err) => console.error('Redis: Connection Error', err));
client.on('end', () => console.log('Redis: Connection closed'));

// Connect to Redis (non-blocking)
client.connect().catch((err) => {
  console.error('Failed to connect to Redis:', err.message);
  console.warn('Sessions will use in-memory store (development mode)');
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  try {
    await client.quit();
  } catch (err) {
    console.error('Error closing Redis connection:', err);
  }
  process.exit();
});

module.exports = client;