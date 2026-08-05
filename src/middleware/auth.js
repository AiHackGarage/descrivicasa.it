const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

module.exports = { authMiddleware };
