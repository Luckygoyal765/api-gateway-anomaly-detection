const { createClient } = require('redis');

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  // Without these two settings, the client QUEUES commands while
  // disconnected and waits to reconnect - meaning a request can hang
  // forever instead of failing fast. disableOfflineQueue makes commands
  // reject immediately if Redis isn't connected, and a short
  // connectTimeout stops a single reconnect attempt from hanging too
  // long. This is what actually makes our "fail open" logic in
  // rateLimiter.js reachable.
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});

client.on('error', (err) => console.error('Redis client error:', err));

// Connect immediately when this module is first required. Top-level
// await isn't used here so this stays a plain CommonJS module - the
// connection happens in the background and node-redis queues commands
// until it's ready.
client.connect().catch((err) => console.error('Redis connect failed:', err));

module.exports = client;
