const { createClient } = require('redis');

// Initialize the client
const client = createClient({
    url: process.env.REDIS_URL
});

// Event listeners for production monitoring
client.on('connect', () => console.log('Redis: Connected'));
client.on('ready', () => console.log('Redis: Ready to use'));
client.on('error', (err) => console.error('Redis: Connection Error', err));
client.on('end', () => console.log('Redis: Connection closed'));

// Handle graceful shutdown
process.on('SIGINT', async () => {
    await client.quit();
    process.exit();
});

module.exports = client;