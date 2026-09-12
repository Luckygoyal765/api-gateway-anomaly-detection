const jwt = require('jsonwebtoken');

// Every request that hits a protected route passes through here FIRST,
// before it ever reaches the proxy layer. This is the gateway's job:
// stop bad requests at the edge, so backend services never have to
// worry about auth at all.
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.split(' ')[1];

  try {
    // jwt.verify checks the signature AND the expiry in one call.
    // If either fails, it throws - that's why this is in a try/catch.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // downstream handlers/proxies can read req.user
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
