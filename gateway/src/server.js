require('dotenv').config();
const express = require('express');
const morgan = require('morgan');

const authMiddleware = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimiter');
const trafficLogger = require('./middleware/trafficLogger');
const authRoutes = require('./routes/auth');
const buildProxyRoutes = require('./routes/proxy');

const app = express();
const PORT = process.env.PORT || 8080;

// morgan logs every request that hits the gateway - this is your first
// window into traffic patterns, and later it's the raw material the
// anomaly detection service will consume.
app.use(morgan('combined'));
app.use(express.json());

// Health check - no auth needed. Load balancers/orchestrators ping this
// to know if this gateway instance is alive.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Traffic logging sees EVERY request first, regardless of what
// happens to it next - the anomaly detector needs the complete
// picture, including rejected and rate-limited requests.
app.use(trafficLogger);

// Rate limiting applies to EVERYTHING below this line, including the
// login endpoint - this is what stops someone from brute-forcing logins
// or hammering the gateway before they've even gotten a token.
app.use(rateLimiter);

// Public: anyone can hit this to get a token for testing.
app.use('/auth', authRoutes);

// Everything below this line requires a valid JWT.
app.use(authMiddleware);

// Route to backend services based on path prefix.
buildProxyRoutes(app);

app.listen(PORT, () => {
  console.log(`API gateway listening on port ${PORT}`);
});
