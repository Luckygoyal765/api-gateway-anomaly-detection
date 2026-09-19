const { createProxyMiddleware } = require('http-proxy-middleware');

function buildProxyRoutes(app) {
  app.use(
    '/api/service-a',
    createProxyMiddleware({
      target: process.env.SERVICE_A_URL || 'http://service-a:4001',
      changeOrigin: true,
      pathRewrite: { '^/api/service-a': '' },
    })
  );

  app.use(
    '/api/service-b',
    createProxyMiddleware({
      target: process.env.SERVICE_B_URL || 'http://service-b:4002',
      changeOrigin: true,
      pathRewrite: { '^/api/service-b': '' },
    })
  );
}

module.exports = buildProxyRoutes;