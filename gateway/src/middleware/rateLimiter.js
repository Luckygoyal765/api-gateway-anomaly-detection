const redis = require('./redisClient');

// This Lua script runs INSIDE Redis as a single atomic operation - no
// other command can interleave between the read and the write. That's
// what closes the race condition: two simultaneous requests can't both
// see "1 token left" and both get allowed.
//
// KEYS[1] = bucket key (per client IP)
// ARGV[1] = capacity (max tokens the bucket can hold)
// ARGV[2] = refill rate (tokens added per second)
// ARGV[3] = current unix timestamp (seconds, as a float)
const TOKEN_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1])
  local last_refill = tonumber(bucket[2])

  if tokens == nil then
    -- first request ever from this IP: start with a full bucket
    tokens = capacity
    last_refill = now
  end

  -- refill based on how much time passed since we last touched this bucket
  local elapsed = math.max(0, now - last_refill)
  tokens = math.min(capacity, tokens + (elapsed * refill_rate))

  local allowed = 0
  if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
  end

  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, 3600) -- cleanup: forget IPs idle for 1hr

  return { allowed, tokens }
`;

const CAPACITY = parseInt(process.env.RATE_LIMIT_CAPACITY || '10', 10);
const REFILL_RATE = parseFloat(process.env.RATE_LIMIT_REFILL_RATE || '1');

async function rateLimiter(req, res, next) {
  const clientIp = req.ip;
  const key = `rate_limit:${clientIp}`;
  const now = Date.now() / 1000;

  try {
    const [allowed, remaining] = await redis.eval(
      TOKEN_BUCKET_SCRIPT,
      { keys: [key], arguments: [String(CAPACITY), String(REFILL_RATE), String(now)] }
    );

    res.set('X-RateLimit-Remaining', Math.floor(remaining));

    if (allowed === 1) {
      return next();
    }

    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  } catch (err) {
    // If Redis is down, we choose to FAIL OPEN (let the request through)
    // rather than take the whole gateway down. This is a real design
    // decision worth defending in an interview: fail-open trades safety
    // for availability. Fail-closed would do the opposite.
    console.error('Rate limiter error, failing open:', err.message);
    return next();
  }
}

module.exports = rateLimiter;
