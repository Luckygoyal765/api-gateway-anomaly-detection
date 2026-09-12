const { createProxyMiddleware } = require('http-proxy-middleware');

// This is the "routing" part of the gateway's job: given a path prefix,
// decide which backend service actually handles it. Right now it's a
// hardcoded table - in week 5+ this could come from a service registry
// (e.g. Consul, or just a config row in Postgres) so services can
// register themselves dynamically instead of being hardcoded here.
function buildProxyRoutes(app) {
  app.use('/api/service-a', createProxyMiddleware({
    target: process.env.SERVICE_A_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/service-a': '' },
    // logProvider silences the default verbose logger; we use morgan instead.
    logger: console,
  }));

  app.use('/api/service-b', createProxyMiddleware({
    target: process.env.SERVICE_B_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/service-b': '' },
    logger: console,
  }));
}

module.exports = buildProxyRoutes;
