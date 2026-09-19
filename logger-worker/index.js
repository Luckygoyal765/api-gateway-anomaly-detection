const redis = require('redis');
const { Pool } = require('pg');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PG_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/audit_db';

const redisClient = redis.createClient({ url: REDIS_URL });
const pgPool = new Pool({ connectionString: PG_URL });

async function processBatch() {
  try {
    // 1. Read up to 100 entries from Redis Stream 'traffic_logs'
    const response = await redisClient.xRead(
      [{ key: 'traffic_logs', id: '0-0' }],
      { COUNT: 100, BLOCK: 2000 }
    );

    if (!response || response.length === 0) return;

    const entries = response[0].messages;
    if (entries.length === 0) return;

    // 2. Prepare bulk SQL values
    const valueTuples = [];
    const params = [];
    let paramIndex = 1;

    entries.forEach((entry) => {
      const msg = entry.message;
      valueTuples.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, to_timestamp($${paramIndex + 3} / 1000.0))`);
      params.push(
        msg.ip || 'unknown',
        msg.path || '/',
        parseInt(msg.status || 200, 10),
        parseInt(msg.timestamp || Date.now(), 10)
      );
      paramIndex += 4;
    });

    // 3. Perform atomic bulk INSERT into PostgreSQL
    const query = `
      INSERT INTO security_audit_logs (ip_address, endpoint, status_code, created_at)
      VALUES ${valueTuples.join(', ')}
    `;
    await pgPool.query(query, params);

    // 4. Trim stream safely using numeric MAXLEN
    await redisClient.xTrim('traffic_logs', 'MAXLEN', 1000, { APPROXIMATE: true });

    // 5. Delete processed entries to prevent reading duplicate entries
    const entryIds = entries.map(e => e.id);
    await redisClient.xDel('traffic_logs', entryIds);
    console.log(`[Worker] Batched & inserted ${entries.length} audit logs into PostgreSQL.`);
  } catch (err) {
    console.error('[Worker] Batch processing error:', err.message);
  }
}

async function start() {
  await redisClient.connect();
  console.log('[Worker] Connected to Redis and PostgreSQL. Listening for traffic streams...');
  while (true) {
    await processBatch();
  }
}

start();