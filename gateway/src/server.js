require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const client = require('prom-client');
const crypto = require('crypto');

const authMiddleware = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimiter');
const trafficLogger = require('./middleware/trafficLogger');
const authRoutes = require('./routes/auth');
const buildProxyRoutes = require('./routes/proxy');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. Prometheus System Metrics Setup
client.collectDefaultMetrics();

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});

// Middleware to record request duration
app.use((req, res, next) => {
  const end = httpRequestDurationSeconds.startTimer();
  res.on('finish', () => {
    end({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode
    });
  });
  next();
});

// 2. Standard Global Middlewares
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// 2.1 Distributed Request Tracing Middleware
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// 3. Metrics & Health Endpoints (Unprotected)
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 4. Traffic Logging & Rate Limiting
app.use(trafficLogger);
app.use(rateLimiter);

// 5. Unprotected API Routes
app.use('/stats', statsRoutes);
app.use('/auth', authRoutes);

// 6. Protected Routes (Requires JWT Auth)
app.use(authMiddleware);

// 7. Dynamic Proxy Routes Execution
buildProxyRoutes(app);

app.listen(PORT, () => {
  console.log(`API gateway listening on port ${PORT}`);
});