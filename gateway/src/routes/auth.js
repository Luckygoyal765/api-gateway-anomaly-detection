const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

// This is a STAND-IN for a real auth service. In week 1 we just want
// something that hands out valid tokens so we can test the gateway's
// auth middleware end to end. Later this could call a real user DB.
router.post('/login', (req, res) => {
  const { username } = req.body || {};

  if (!username) {
    return res.status(400).json({ error: 'username is required' });
  }

  const token = jwt.sign(
    { username },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.json({ token });
});

module.exports = router;
