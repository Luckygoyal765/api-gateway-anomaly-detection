const { createProxyMiddleware } = require('http-proxy-middleware');
const CircuitBreaker = require('opossum');

// Circuit Breaker configuration options
const breakerOptions = {
  timeout: 3000,              // Trigger failure if downstream takes > 3s
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 10000         // Keep circuit OPEN for 10s before attempting half-open recovery
};

// Dummy async action to trigger circuit state changes
const proxyAction = async (fn) => await fn();

// Initialize breakers for downstream services
const serviceABreaker = new CircuitBreaker(proxyAction, breakerOptions);
const serviceBBreaker = new CircuitBreaker(proxyAction, breakerOptions);

// Breaker event logging for visibility
serviceABreaker.on('open', () => console.warn('⚠️ [CIRCUIT BREAKER] Service A circuit OPENED!'));
serviceABreaker.on('close', () => console.log('✅ [CIRCUIT BREAKER] Service A circuit CLOSED. Service healthy.'));
serviceBBreaker.on('open', () => console.warn('⚠️ [CIRCUIT BREAKER] Service B circuit OPENED!'));
serviceBBreaker.on('close', () => console.log('✅ [CIRCUIT BREAKER] Service B circuit CLOSED. Service healthy.'));

function buildProxyRoutes(app) {
  // Service A Proxy Middleware with Circuit Breaker Guard
  const serviceAProxy = createProxyMiddleware({
    target: process.env.SERVICE_A_URL || 'http://service-a:4001',
    changeOrigin: true,
    pathRewrite: { '^/api/service-a': '' },
    onProxyReq: (proxyReq, req, res) => {
      if (req.requestId) {
        proxyReq.setHeader('X-Request-ID', req.requestId);
      }
    },
    onError: (err, req, res) => {
      res.status(503).json({
        error: 'Service A is currently unavailable or degraded.',
        circuitState: serviceABreaker.opened ? 'OPEN' : 'CLOSED'
      });
    }
  });

  app.use('/api/service-a', (req, res, next) => {
    if (serviceABreaker.opened) {
      return res.status(503).json({
        error: 'Service A Circuit Breaker is OPEN. Request short-circuited.',
        status: 'Circuit Open'
      });
    }
    serviceABreaker.fire(() => new Promise((resolve) => {
      serviceAProxy(req, res, (result) => resolve(result));
    })).catch(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: 'Service A request failed.' });
      }
    });
  });

  // Service B Proxy Middleware with Circuit Breaker Guard
  const serviceBProxy = createProxyMiddleware({
    target: process.env.SERVICE_B_URL || 'http://service-b:4002',
    changeOrigin: true,
    pathRewrite: { '^/api/service-b': '' },
    onProxyReq: (proxyReq, req, res) => {
      if (req.requestId) {
        proxyReq.setHeader('X-Request-ID', req.requestId);
      }
    },
    onError: (err, req, res) => {
      res.status(503).json({
        error: 'Service B is currently unavailable or degraded.',
        circuitState: serviceBBreaker.opened ? 'OPEN' : 'CLOSED'
      });
    }
  });

  app.use('/api/service-b', (req, res, next) => {
    if (serviceBBreaker.opened) {
      return res.status(503).json({
        error: 'Service B Circuit Breaker is OPEN. Request short-circuited.',
        status: 'Circuit Open'
      });
    }
    serviceBBreaker.fire(() => new Promise((resolve) => {
      serviceBProxy(req, res, (result) => resolve(result));
    })).catch(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: 'Service B request failed.' });
      }
    });
  });
}

module.exports = buildProxyRoutes;