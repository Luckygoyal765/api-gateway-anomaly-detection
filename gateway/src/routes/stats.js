const express = require('express');
const redis = require('../middleware/redisClient');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const WINDOW_MS = 60 * 1000;

    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Redis Stream IDs are based on timestamps.
    // Read only events from the last 60 seconds.
    const entries = await redis.xRange(
      'traffic_logs',
      `${windowStart}-0`,
      `${now}-0`
    );

    let totalRequests = 0;
    let blockedRequests = 0;
    let errorRequests = 0;

    const uniqueIPs = new Set();
    const uniquePaths = new Set();

    for (const entry of entries) {
      const data = entry.message;

      totalRequests++;

      uniqueIPs.add(data.ip);
      uniquePaths.add(data.path);

      const status = Number(data.status);

      if (status === 429) {
        blockedRequests++;
      }

      if (status >= 400) {
        errorRequests++;
      }
    }

    const errorRate =
      totalRequests > 0
        ? errorRequests / totalRequests
        : 0;

    const requestsPerSecond =
      totalRequests / (WINDOW_MS / 1000);

    res.json({
      windowSeconds: 60,
      totalRequests,
      requestsPerSecond: Number(requestsPerSecond.toFixed(2)),
      blockedRequests,
      errorRequests,
      errorRate: Number(errorRate.toFixed(4)),
      uniqueIPs: uniqueIPs.size,
      uniquePaths: uniquePaths.size,
      timestamp: now
    });

  } catch (err) {
    console.error('Stats API error:', err.message);

    res.status(500).json({
      error: 'Unable to retrieve traffic statistics'
    });
  }
});

module.exports = router;