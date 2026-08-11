const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const pool = require('../db/pool');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante' });
  }
  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const [users] = await pool.query('SELECT plan FROM users WHERE id = ?', [payload.id]);
    req.user = { ...payload, plan: users.length > 0 ? users[0].plan : 'free' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

module.exports = { authMiddleware };
