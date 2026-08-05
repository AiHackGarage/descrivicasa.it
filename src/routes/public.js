const express = require('express');
const pool = require('../db/pool');
const { injectContacts } = require('../utils/text');
const { generatePdf } = require('../services/pdf');
const { serverError } = require('../utils/errors');

const router = express.Router();

// Public property API
router.get('/p/:uuid', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS user_name, u.email AS user_email, u.avatar AS agent_avatar
       FROM properties p JOIN users u ON p.user_id = u.id
       WHERE p.uuid = ? AND p.is_public = TRUE AND p.status IN ('published','draft')`,
      [req.params.uuid]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    const p = rows[0];
    p.agent_name = p.agent_name || p.user_name;
    p.agent_email = p.agent_email || p.user_email;
    p.agent_phone = p.agent_phone || null;
    p.photos = p.photos || [];
    p.elevator = !!p.elevator;
    p.air_conditioning = !!p.air_conditioning;
    p.parking = !!p.parking;
    p.basement = !!p.basement;
    p.is_public = true;

    if (p.description) {
      p.description = injectContacts(p.description, p);
    }

    res.json({ property: p });
  } catch (err) {
    serverError(err, res, 'Public property');
  }
});

// PDF download
router.get('/p/:uuid/pdf', (req, res) => generatePdf(req, res));

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Debug DB
router.get('/debug-db', async (req, res) => {
  try {
    const [tables] = await pool.query('SHOW TABLES');
    const [users] = await pool.query('SELECT COUNT(*) AS count FROM users');
    const [properties] = await pool.query('SELECT COUNT(*) AS count FROM properties');
    res.json({ tables: tables.map(t => Object.values(t)[0]), userCount: users[0].count, propertyCount: properties[0].count });
  } catch (err) {
    serverError(err, res, 'Debug DB');
  }
});

module.exports = router;
