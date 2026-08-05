// Config: environment variables, constants, and derived configuration
const path = require('path');

// env loading
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') }); // Hostinger parent dir
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });         // project-level overrides

// ── Server ──
const PORT = process.env.PORT || 8000;

// ── Stripe ──
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY_PROVA || process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_PROVA || process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID_BASE = process.env.STRIPE_PRICE_ID_BASIC_PROVA || process.env.STRIPE_PRICE_ID_BASE || '';
const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO_PROVA || process.env.STRIPE_PRICE_ID_PRO || '';
const STRIPE_PUBLIC_KEY = process.env.STRIPE_PUBLIC_KEY_PROVA || process.env.STRIPE_PUBLIC_KEY || '';

// ── Uploads ──
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || path.join(__dirname, '..', '..', 'persistent_uploads');

// ── Database ──
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'descrivicasa',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'descrivicasa',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
};

// ── JWT ──
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET non impostato nelle variabili d\'ambiente. Il server non può avviarsi.');
  process.exit(1);
}
const JWT_EXPIRES = '30d';

// ── Google OAuth ──
const GOOGLE_CLIENT_ID = '718077316234-lato3jpdj7hc6b1ts5nc532pnhs5eeun.apps.googleusercontent.com';

// ── OpenRouter ──
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const CHAT_MODEL = process.env.CHAT_MODEL || 'deepseek/deepseek-chat';

// ── Plan Limits ──
const PLAN_LIMITS = { free: 3, base: 50, pro: 9999 };

const PLAN_CONFIG = {
  free:  { maxPhotos: 5,  maxTokens: 2048, wordLimit: 400 },
  base:  { maxPhotos: 5,  maxTokens: 2048, wordLimit: 400 },
  pro:   { maxPhotos: 10, maxTokens: 4096, wordLimit: 800 },
};

module.exports = {
  PORT,
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_BASE, STRIPE_PRICE_ID_PRO, STRIPE_PUBLIC_KEY,
  UPLOAD_DIR,
  DB_CONFIG,
  JWT_SECRET, JWT_EXPIRES,
  GOOGLE_CLIENT_ID,
  OPENROUTER_API_KEY, VISION_MODEL, OPENROUTER_BASE, CHAT_MODEL,
  PLAN_LIMITS, PLAN_CONFIG,
};
