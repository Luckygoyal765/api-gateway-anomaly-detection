const redis = require('./redisClient');

// This runs AFTER a response is sent (res.on('finish')), so we always
// know the final status code - whether the request was allowed,
// rejected by auth, or rate-limited. Every single outcome gets logged,
// because the anomaly detector needs the full picture, not just
// successful requests.
function trafficLogger(req, res, next) {
  res.on('finish', async () => {
    try {
      // XADD appends an entry to a Redis Stream. '*' means "let Redis
      // generate the entry ID automatically" (based on timestamp).
      // Streams are append-only and support multiple independent
      // readers - unlike a Redis Pub/Sub channel, a reader that's
      // offline for a bit can catch up later instead of losing messages.
      await redis.xAdd('traffic_logs', '*', {
        ip: req.ip || 'unknown',
        path: req.path,
        method: req.method,
        status: String(res.statusCode),
        timestamp: String(Date.now()),
      });
    } catch (err) {
      // Logging should NEVER break the actual request/response cycle.
      // If Redis is unavailable, we just skip logging this one request.
      console.error('Traffic logging failed:', err.message);
    }
  });

  next();
}

module.exports = trafficLogger;
