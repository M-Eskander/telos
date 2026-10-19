const { createClient } = require('redis');

// If a REDIS_URL is provided but lacks authentication, and a REDIS_PASSWORD
// exists in the environment, inject the password into the URL so the client
// always uses an authenticated URL. This mutates process.env early so other
// modules that read REDIS_URL see the authenticated form.
if (process.env.REDIS_URL && process.env.REDIS_PASSWORD) {
  try {
    const u = new URL(process.env.REDIS_URL);
    if (!u.password) {
      u.password = process.env.REDIS_PASSWORD;
      // rewrite the env var so other consumers see the auth'd URL
      process.env.REDIS_URL = u.toString();
      console.log('Injected password into REDIS_URL for authenticated connection');
    }
  } catch (e) {
    // ignore parse errors and fall back to other config methods
  }
}

// Initialize the client
// Supports both legacy REDIS_URL and separate REDIS_HOST/REDIS_PORT
let redisConfig;
if (process.env.REDIS_URL) {
  // Prefer passing `password` explicitly to createClient in addition to URL.
  // Some redis client versions accept both and this avoids URL encoding oddities.
  redisConfig = {
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD || undefined
  };
} else {
  redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500)
    }
  };
}

// Testing/dev fallback: if tests opt into real Redis but password is missing,
// provide the common test password so commands authenticate.
if (process.env.USE_REAL_REDIS === 'true' && !redisConfig.password) {
  redisConfig.password = process.env.REDIS_PASSWORD || 'password';
}


// Debug: emit the config being used (avoid printing password in prod)
try {
  const safe = Object.assign({}, redisConfig);
  if (safe.password) safe.password = '***REDACTED***';
  console.log('Redis client config:', safe);
} catch (e) {}

const client = createClient(redisConfig);

// Event listeners for production monitoring
client.on('connect', () => console.log('Redis: Connected'));
client.on('ready', () => console.log('Redis: Ready to use'));
client.on('error', (err) => console.error('Redis: Connection Error', err));
client.on('end', () => console.log('Redis: Connection closed'));

// Handle graceful shutdown in non-test environments
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', async () => {
    try {
      await client.quit();
    } catch (err) {
      console.error('Error closing Redis connection:', err);
    }
    process.exit();
  });
}

module.exports = client;