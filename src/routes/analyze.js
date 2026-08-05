const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db/pool');
const { UPLOAD_DIR, PLAN_CONFIG, PLAN_LIMITS, OPENROUTER_API_KEY, OPENROUTER_BASE, CHAT_MODEL } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimit');
const { describeProperty } = require('../services/ai/vision');
const { processUploadedFiles } = require('../services/image');
const { checkGenerationLimit } = require('../utils/limits');
const { extractTitle, injectContacts } = require('../utils/text');
const { CHAT_SYSTEM } = require('../services/ai/prompts');
const { serverError, aiError } = require('../utils/errors');
const { validate } = require('../utils/validate');
const { chatSchema } = require('../utils/schemas');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const session = crypto.randomUUID().slice(0, 12);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${session}_${crypto.randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
  },
});

// Analyze route
router.post('/analyze', aiLimiter, authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto' });
    }

    const plan = req.user.plan || 'free';
    const maxPhotos = (PLAN_CONFIG[plan] || PLAN_CONFIG.free).maxPhotos;
    if (req.files.length > maxPhotos) {
      return res.status(400).json({ error: `Il piano ${plan} permette al massimo ${maxPhotos} foto. Passa a Pro per caricarne fino a 10.` });
    }

    await processUploadedFiles(req.files);

    const limitCheck = await checkGenerationLimit(req.user.id, plan);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Hai raggiunto il limite di ${PLAN_LIMITS[req.user.plan || 'free']} descrizioni gratuite. Passa a un piano a pagamento per continuare.`,
        remaining: 0,
      });
    }

    const result = await describeProperty(req.files.map(f => f.path), 'it', plan);
    if (result.error) return aiError(result, res, 'analyze');

    await pool.query('UPDATE users SET monthly_generations = monthly_generations + 1 WHERE id = ?', [req.user.id]);

    const finalDescription = injectContacts(result.description, {
      agent_name: req.user.name,
      agent_email: req.user.email,
      agent_phone: null,
    });

    const imageUrls = req.files.map(f => `/media/uploads/${path.basename(f.path)}`);
    await pool.query(
      'INSERT INTO generations (user_id, description, image_urls, model) VALUES (?, ?, ?, ?)',
      [req.user.id, finalDescription, JSON.stringify(imageUrls), result.model || '']
    ).catch(err => logger.error('Save history error:', err.message));

    res.json({
      description: finalDescription,
      title: extractTitle(finalDescription, null),
      images: imageUrls,
      model: result.model || '',
      remaining: limitCheck.remaining - 1,
    });
  } catch (err) {
    serverError(err, res, 'Analyze');
  }
});

// Chatbot
router.post('/api/chat', aiLimiter, async (req, res) => {
  try {
    const errors = validate(req.body, chatSchema);
    if (errors) return res.status(400).json({ error: errors[0] });
    const { messages } = req.body;
    const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://descrivicasa.it',
        'X-Title': 'DescriviCasa Chat',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: 'system', content: CHAT_SYSTEM }, ...messages.slice(-20)],
        max_tokens: 1024,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return res.status(500).json({ error: 'Errore del chatbot' });
    const data = await resp.json();
    res.json({ reply: data.choices[0].message.content, model: data.model });
  } catch (err) {
    serverError(err, res, 'Chat');
  }
});

module.exports = router;
