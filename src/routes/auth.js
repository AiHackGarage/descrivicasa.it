const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../db/pool');
const { JWT_SECRET, JWT_EXPIRES, GOOGLE_CLIENT_ID, PLAN_LIMITS } = require('../config');
const { authLimiter } = require('../middleware/rateLimit');
const { authMiddleware } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

const router = express.Router();
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, marketing_consent } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e password sono obbligatori' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La password deve essere almeno 6 caratteri' });
    }
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email già registrata' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password, marketing_consent) VALUES (?, ?, ?, ?)',
      [name, email, hashed, marketing_consent ? 1 : 0]
    );
    const token = jwt.sign({ id: result.insertId, email, name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.status(201).json({ token, user: { id: result.insertId, name, email, plan: 'free', monthly_limit: PLAN_LIMITS.free, remaining: PLAN_LIMITS.free } });
  } catch (err) {
    serverError(err, res, 'Auth register');
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e password sono obbligatori' });
    }
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Email o password errati' });
    }
    const user = users[0];
    if (!user.password) {
      return res.status(401).json({ error: 'Account registrato con Google, usa Accedi con Google' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Email o password errati' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const limit = PLAN_LIMITS[user.plan] || 3;
    const remaining = Math.max(0, limit - (user.monthly_generations || 0));
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, plan: user.plan, monthly_limit: limit, remaining } });
  } catch (err) {
    serverError(err, res, 'Auth login');
  }
});

// Google auth
router.post('/auth/google', authLimiter, async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Token Google mancante' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let [users] = await pool.query('SELECT * FROM users WHERE google_id = ? OR email = ?', [googleId, email]);
    let user;
    if (users.length > 0) {
      user = users[0];
      if (!user.google_id) {
        await pool.query('UPDATE users SET google_id = ?, avatar = COALESCE(?, avatar) WHERE id = ?', [googleId, picture, user.id]);
        user.google_id = googleId;
      }
    } else {
      const [result] = await pool.query('INSERT INTO users (name, email, google_id, avatar) VALUES (?, ?, ?, ?)', [name, email, googleId, picture]);
      user = { id: result.insertId, name, email, google_id: googleId, avatar: picture, plan: 'free' };
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const limit = PLAN_LIMITS[user.plan] || 3;
    const remaining = Math.max(0, limit - (user.monthly_generations || 0));
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar || picture, plan: user.plan, monthly_limit: limit, remaining } });
  } catch (err) {
    serverError(err, res, 'Auth google');
  }
});

// History
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, description, image_urls, model, property_uuid, created_at FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ history: rows.map(r => ({ ...r, image_urls: r.image_urls ? JSON.parse(r.image_urls) : [] })) });
  } catch (err) {
    serverError(err, res, 'Auth history');
  }
});

// Me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, avatar, plan, monthly_generations, monthly_reset, created_at, stripe_customer_id, stripe_subscription_id, subscription_status FROM users WHERE id = ?',
      [req.user.id]
    );
    if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });
    const user = users[0];
    const limit = PLAN_LIMITS[user.plan || 'free'];
    const remaining = Math.max(0, limit - (user.monthly_generations || 0));
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const resetMonth = user.monthly_reset ? user.monthly_reset.slice(0, 7) : null;
    const genRemaining = (resetMonth !== thisMonth) ? limit : remaining;
    res.json({ user: { ...user, monthly_limit: limit, remaining: genRemaining } });
  } catch (err) {
    serverError(err, res, 'Auth me');
  }
});

module.exports = router;
