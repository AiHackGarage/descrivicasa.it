const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Project-level .env overrides (e.g., Stripe test keys)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.set('trust proxy', 1);

// ── Stripe ─────────────────────────────────────────────────────────
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY_PROVA || process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_PROVA || process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID_BASE = process.env.STRIPE_PRICE_ID_BASIC_PROVA || process.env.STRIPE_PRICE_ID_BASE || '';
const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO_PROVA || process.env.STRIPE_PRICE_ID_PRO || '';
const STRIPE_PUBLIC_KEY = process.env.STRIPE_PUBLIC_KEY_PROVA || process.env.STRIPE_PUBLIC_KEY || '';

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
  logger.info('✅ Stripe initialized');
} else {
  logger.info('⚠️  Stripe non configurato (manca STRIPE_SECRET_KEY)');
}
const PORT = process.env.PORT || 8000;

// ── Config ────────────────────────────────────────────────────────
// UPLOAD_DIR: fuori dal path di deploy così sopravvive ai `git push` su Hostinger.
// Default: ../persistent_uploads (sibling della cartella dell'app).
// Su Hostinger impostare via hPanel: UPLOAD_DIR = /home/u116036854/descrivicasa_uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR 
  || path.join(__dirname, '..', 'persistent_uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Database ──────────────────────────────────────────────────────
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'descrivicasa',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'descrivicasa',
  waitForConnections: true,
  connectionLimit: 10,
};

const pool = mysql.createPool(DB_CONFIG);

// ── JWT ────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('❌ JWT_SECRET non impostato nelle variabili d\'ambiente. Il server non può avviarsi.');
  process.exit(1);
}
const JWT_EXPIRES = '30d';

// ── Google OAuth ──────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = '718077316234-lato3jpdj7hc6b1ts5nc532pnhs5eeun.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ── Multer ─────────────────────────────────────────────────────────
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

// ── Image processing utilities ─────────────────────────────────────
const IMAGE_MAX_DIM = 1920;
const IMAGE_QUALITY = 80;
const PDF_IMAGE_WIDTH = 800;

// Processa un'immagine uploadata: ridimensiona a max 1920px, JPEG qualità 80%
async function processUploadedImage(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();
    // Salta se è già più piccola del limite (es. già processata)
    if (metadata.width <= IMAGE_MAX_DIM && metadata.height <= IMAGE_MAX_DIM
        && metadata.format === 'jpeg') {
      return; // già ottimale
    }
    const tmpPath = filePath + '.tmp';
    await sharp(filePath)
      .resize(IMAGE_MAX_DIM, IMAGE_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGE_QUALITY, progressive: true })
      .toFile(tmpPath);
    fs.renameSync(tmpPath, filePath);
    logger.info({ path: path.basename(filePath), origSize: metadata.width + 'x' + metadata.height }, '🖼️ Image compressed');
  } catch (err) {
    logger.warn({ err: err.message, file: filePath }, 'Image processing failed, keeping original');
  }
}

// Processa tutte le immagini di un upload
async function processUploadedFiles(files) {
  if (!files || files.length === 0) return;
  await Promise.all(files.map(f => processUploadedImage(f.path)));
}

// Ridimensiona un'immagine per embedding nel PDF (max 800px larghezza)
async function resizeForPdf(filePath) {
  try {
    const buffer = await sharp(filePath)
      .resize(PDF_IMAGE_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, progressive: true })
      .toBuffer();
    return buffer;
  } catch (err) {
    logger.warn({ err: err.message, file: filePath }, 'PDF image resize failed');
    return null;
  }
}

// ── Stripe webhook (richiede raw body, prima di express.json()) ────
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe non configurato' });

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error('Stripe webhook signature error:', err.message);
    return res.status(400).json({ error: `Firma webhook non valida` });
  }

  try {
    // Gestisci checkout.session.completed → upgrade piano utente
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = parseInt(session.metadata?.userId, 10);
      const plan = session.metadata?.plan;

      if (userId && plan && ['base', 'pro'].includes(plan)) {
        // Prima prova UPDATE completo (con colonne Stripe se esistono)
        try {
          await pool.query(
            'UPDATE users SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = ? WHERE id = ?',
            [plan, session.customer || null, session.subscription || null, 'active', userId]
          );
        } catch (_) {
          // Fallback: solo piano (colonne Stripe non ancora migrate)
          await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, userId]);
        }
        logger.info(`✅ User ${userId} upgraded to ${plan}`);
      }
    }

    // Gestisci subscription updates (rinnovi, cancellazioni, mancati pagamenti)
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

      if (customerId) {
        try {
          await pool.query(
            'UPDATE users SET subscription_status = ? WHERE stripe_customer_id = ?',
            [sub.status, customerId]
          );
        } catch (_) { /* colonne Stripe non ancora migrate */ }

        // Downgrade a free se cancellato o insolvente
        if (sub.status === 'canceled' || sub.status === 'unpaid') {
          try {
            await pool.query(
              'UPDATE users SET plan = "free", stripe_subscription_id = NULL WHERE stripe_customer_id = ?',
              [customerId]
            );
          } catch (_) {
            await pool.query('UPDATE users SET plan = "free" WHERE stripe_customer_id = ?', [customerId]);
          }
          logger.info(`⬇️ Customer ${customerId} downgraded to free (status: ${sub.status})`);
        } else if (sub.status === 'active') {
          // Aggiorna subscription_id
          try {
            await pool.query(
              'UPDATE users SET stripe_subscription_id = ? WHERE stripe_customer_id = ?',
              [sub.id, customerId]
            );
          } catch (_) { /* colonna stripe_subscription_id non ancora migrata */ }

          // Rileva cambio piano effettivo (quando il price cambia, es. downgrade a scadenza)
          const priceId = sub.items?.data?.[0]?.price?.id;
          if (priceId) {
            const planFromPrice = priceId === STRIPE_PRICE_ID_PRO ? 'pro'
                                : priceId === STRIPE_PRICE_ID_BASE ? 'base'
                                : null;
            if (planFromPrice) {
              // Recupera piano corrente dal DB
              const [users] = await pool.query(
                'SELECT plan FROM users WHERE stripe_customer_id = ?',
                [customerId]
              );
              if (users.length > 0 && users[0].plan !== planFromPrice) {
                try {
                  await pool.query(
                    'UPDATE users SET plan = ? WHERE stripe_customer_id = ?',
                    [planFromPrice, customerId]
                  );
                  logger.info(`🔄 Customer ${customerId} plan updated to ${planFromPrice} (price change detected)`);
                } catch (_) { /* skip */ }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error('Stripe webhook processing error:', err);
    return res.status(500).json({ error: 'Errore processamento webhook' });
  }

  res.json({ received: true });
});

// ── Middleware ─────────────────────────────────────────────────────
app.use(express.json());
app.use('/media/uploads', express.static(UPLOAD_DIR));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // CSP via header + meta tag (Hostinger proxy overwrites Content-Security-Policy)
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; frame-src https://js.stripe.com https://accounts.google.com; connect-src 'self' https://api.openrouter.ai https://api.stripe.com; img-src 'self' data: blob: https:; font-src 'self' https://fonts.gstatic.com;");
  next();
});

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste. Riprova tra qualche minuto.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste AI. Riprova tra un minuto.' },
});

// Auth middleware
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

// ── Database setup ────────────────────────────────────────────────
async function initDatabase() {
  try {
    const conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) DEFAULT NULL,
        google_id VARCHAR(255) DEFAULT NULL UNIQUE,
        avatar VARCHAR(500) DEFAULT NULL,
        plan ENUM('free','base','pro') DEFAULT 'free',
        monthly_generations INT DEFAULT 0,
        monthly_reset DATE DEFAULT NULL,
        marketing_consent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    // Add columns if missing (for existing tables)
    try { await conn.query(`ALTER TABLE users ADD COLUMN monthly_generations INT DEFAULT 0 AFTER plan`); } catch (_) {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN monthly_reset DATE DEFAULT NULL AFTER monthly_generations`); } catch (_) {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN marketing_consent BOOLEAN DEFAULT FALSE AFTER monthly_reset`); } catch (_) {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255) DEFAULT NULL AFTER marketing_consent`); } catch (_) {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR(255) DEFAULT NULL AFTER stripe_customer_id`); } catch (_) {}
    try { await conn.query(`ALTER TABLE users ADD COLUMN subscription_status VARCHAR(50) DEFAULT NULL AFTER stripe_subscription_id`); } catch (_) {}

    // Generations history table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS generations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        description TEXT NOT NULL,
        image_urls TEXT DEFAULT NULL,
        model VARCHAR(100) DEFAULT NULL,
        property_uuid VARCHAR(36) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    try { await conn.query(`ALTER TABLE generations ADD COLUMN property_uuid VARCHAR(36) DEFAULT NULL AFTER model`); } catch (_) {}
    // Properties table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        uuid VARCHAR(36) NOT NULL UNIQUE,

        contract_type ENUM('sell','rent') NOT NULL DEFAULT 'sell',
        property_type VARCHAR(50) NOT NULL DEFAULT 'apartment',

        address VARCHAR(300) DEFAULT NULL,
        civic VARCHAR(20) DEFAULT NULL,
        interno VARCHAR(20) DEFAULT NULL,
        cap VARCHAR(10) DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        province VARCHAR(50) DEFAULT NULL,
        zone VARCHAR(200) DEFAULT NULL,
        latitude DECIMAL(10,7) DEFAULT NULL,
        longitude DECIMAL(10,7) DEFAULT NULL,

        surface INT DEFAULT NULL,
        rooms INT DEFAULT NULL,
        bedrooms INT DEFAULT NULL,
        bathrooms INT DEFAULT NULL,
        floor INT DEFAULT NULL,
        total_floors INT DEFAULT NULL,
        elevator BOOLEAN DEFAULT FALSE,

        building_state VARCHAR(50) DEFAULT NULL,
        year_built INT DEFAULT NULL,
        energy_class VARCHAR(5) DEFAULT NULL,
        energy_index VARCHAR(20) DEFAULT NULL,
        heating VARCHAR(50) DEFAULT NULL,
        air_conditioning BOOLEAN DEFAULT FALSE,
        exposure VARCHAR(100) DEFAULT NULL,
        balcony_sqm INT DEFAULT NULL,
        garden_sqm INT DEFAULT NULL,
        parking BOOLEAN DEFAULT FALSE,
        basement BOOLEAN DEFAULT FALSE,
        furnished VARCHAR(20) DEFAULT 'no',

        price DECIMAL(12,2) DEFAULT NULL,
        condo_fees DECIMAL(8,2) DEFAULT NULL,

        agent_name VARCHAR(200) DEFAULT NULL,
        agent_phone VARCHAR(50) DEFAULT NULL,
        agent_email VARCHAR(255) DEFAULT NULL,

        title VARCHAR(200) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        ai_model VARCHAR(100) DEFAULT NULL,
        photos JSON DEFAULT NULL,

        status ENUM('draft','published','archived') DEFAULT 'draft',
        is_public BOOLEAN DEFAULT TRUE,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_uuid (uuid),
        INDEX idx_user (user_id),
        INDEX idx_user_status (user_id, status),
        INDEX idx_public (is_public, status)
      )
    `);
    conn.release();
    logger.info('✅ Database tables ready');

    // Run migrations: add agent columns if missing
    try {
      const migrationConn = await pool.getConnection();
      const [cols] = await migrationConn.query("SHOW COLUMNS FROM properties LIKE 'agent_%'");
      if (cols.length === 0) {
        await migrationConn.query("ALTER TABLE properties ADD COLUMN agent_name VARCHAR(200) DEFAULT NULL AFTER condo_fees");
        await migrationConn.query("ALTER TABLE properties ADD COLUMN agent_phone VARCHAR(50) DEFAULT NULL AFTER agent_name");
        await migrationConn.query("ALTER TABLE properties ADD COLUMN agent_email VARCHAR(255) DEFAULT NULL AFTER agent_phone");
        logger.info('✅ Migration: agent columns added');
      }
      migrationConn.release();
    } catch (migErr) {
      logger.error('⚠️  Migration warning:', migErr.message);
    }
  } catch (err) {
    logger.error('❌ Database init error:', err.message);
    logger.info('⚠️  Server will continue without database');
  }
}

// ── AI Vision Call ────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const SYSTEM_PROMPT = `Sei un copywriter immobiliare professionista, specializzato in annunci per Idealista, Immobiliare.it e Casa.it.
Il tuo compito è analizzare le foto di un immobile e produrre una descrizione COMPLETA, PRONTA PER LA PUBBLICAZIONE, senza alcun preambolo o introduzione.

REGOLE FERREE:
1. NON iniziare mai con "Certamente", "Ecco", "Volentieri" o frasi simili. Vai dritto al contenuto.
2. NON rivolgerti all'utente. Non usare "Lei", "tu", "utente". Scrivi IN TERZA PERSONA come se fossi l'agenzia che presenta l'immobile.
3. STRUTTURA OBBLIGATORIA della descrizione:

🏡 TITOLO ACCATTIVANTE (max 10 parole, es: "Appartamento luminoso in zona Prati con terrazzo abitabile")

📝 DESCRIZIONE PRINCIPALE (2-3 paragrafi, tono caldo e professionale):
- Primo paragrafo: colpo d'occhio, punto di forza unico dell'immobile
- Secondo paragrafo: descrizione degli spazi interni (layout, finiture, luce)
- Terzo paragrafo (opzionale): contesto della zona, punti di interesse

📍 ZONA E POSIZIONE (1 frase sulla zona)

🏷️ CARATTERISTICHE CHIAVE (elenco puntato con spunti per i filtri dei portali):
- Superficie: (mq, se intuibile dalle foto)
- Locali: (numero vani)
- Bagni: (numero)
- Piano: (con o senza ascensore)
- Stato: (ristrutturato, abitabile, da ristrutturare...)
- Esterni: (balcone, terrazzo, giardino...)
- Riscaldamento: (autonomo/centralizzato, se intuibile)
- Classe energetica: (non inventare, ometti se non visibile)

📞 CONTATTI
Scrivi qui i contatti forniti nei dati dell'immobile (nome, telefono, email). Se non sono stati forniti, scrivi: Per maggiori informazioni o per fissare una visita, contatta l'agenzia.

REGOLE DI STILE:
- Tono caldo, professionale, mai troppo tecnico
- Usa aggettivi evocativi ma onesti
- DAI PRIORITÀ a ciò che vedi realmente nelle foto
- Non inventare stanze, piani, metrature o caratteristiche non visibili
- Se non vedi una caratteristica, omettila invece di inventarla
- Non superare le 400 parole in totale
- Cattura l'emozione di vivere in quella casa`;

const USER_PROMPT = `Analizza attentamente queste foto e scrivi una descrizione professionale completa pronta per essere pubblicata su Idealista, seguendo la struttura obbligatoria: TITOLO, DESCRIZIONE in paragrafi, ZONA, CARATTERISTICHE CHIAVE in elenco puntato, CONTATTI. Non aggiungere preamboli o frasi di cortesia. Produci solo la descrizione dell'annuncio. Se tra le immagini c'è una planimetria o un disegno tecnico, ignorarlo: descrivi solo le foto reali.`;

function encodeImage(filepath) {
  return fs.readFileSync(filepath, { encoding: 'base64' });
}

function getMime(ext) {
  const mimeMap = { png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return mimeMap[ext] || 'image/jpeg';
}

// Shared vision API call — handles image encoding, fetch, and response parsing
async function callVisionAPI(imagePaths, systemContent, userText, options = {}) {
  const content = [{ type: 'text', text: userText }];

  for (const fp of imagePaths) {
    if (!fs.existsSync(fp)) continue;
    const b64 = encodeImage(fp);
    const ext = path.extname(fp).toLowerCase().replace('.', '');
    content.push({
      type: 'image_url',
      image_url: { url: `data:${getMime(ext)};base64,${b64}` },
    });
  }

  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://descrivicasa.it',
      'X-Title': 'DescriviCasa',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content },
      ],
      max_tokens: options.maxTokens || 2048,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    return { error: `API error ${resp.status}: ${await resp.text()}` };
  }

  const data = await resp.json();
  try {
    return {
      description: data.choices[0].message.content,
      model: data.model || VISION_MODEL,
      tokens: data.usage || {},
    };
  } catch (e) {
    return { error: 'Unexpected API response', raw: data };
  }
}

async function describeProperty(imagePaths, lang = 'it', plan = 'free') {
  const cfg = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const wordLimit = cfg.wordLimit;
  const systemContent = (lang === 'it' ? SYSTEM_PROMPT : SYSTEM_PROMPT.replace(/italiano/g, 'English').replace(/italiane/g, 'Italian'))
    .replace(/Non superare le \d+ parole in totale/, `Non superare le ${wordLimit} parole in totale`);
  const userText = lang === 'it' ? USER_PROMPT : USER_PROMPT.replace(/italiano/g, 'English');
  return callVisionAPI(imagePaths, systemContent, userText, { maxTokens: cfg.maxTokens });
}

// ── Auth Routes ───────────────────────────────────────────────────

// Registrazione con email
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, marketing_consent } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e password sono obbligatori' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La password deve essere almeno 6 caratteri' });
    }

    // Check if user exists
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
    logger.error('Register error:', err);
    res.status(500).json({ error: 'Errore durante la registrazione' });
  }
});

// Login con email
app.post('/api/login', authLimiter, async (req, res) => {
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
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Errore durante il login' });
  }
});

// Login con Google
app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Token Google mancante' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Check if user exists by google_id or email
    let [users] = await pool.query(
      'SELECT * FROM users WHERE google_id = ? OR email = ?',
      [googleId, email]
    );

    let user;
    if (users.length > 0) {
      user = users[0];
      // Link google_id if not set
      if (!user.google_id) {
        await pool.query('UPDATE users SET google_id = ?, avatar = COALESCE(?, avatar) WHERE id = ?', [googleId, picture, user.id]);
        user.google_id = googleId;
      }
    } else {
      // New user
      const [result] = await pool.query(
        'INSERT INTO users (name, email, google_id, avatar) VALUES (?, ?, ?, ?)',
        [name, email, googleId, picture]
      );
      user = { id: result.insertId, name, email, google_id: googleId, avatar: picture, plan: 'free' };
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const limit = PLAN_LIMITS[user.plan] || 3;
    const remaining = Math.max(0, limit - (user.monthly_generations || 0));
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar || picture, plan: user.plan, monthly_limit: limit, remaining } });
  } catch (err) {
    logger.error('Google auth error:', err);
    res.status(500).json({ error: 'Errore autenticazione Google' });
  }
});

// Ottieni storico descrizioni
app.get('/api/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, description, image_urls, model, property_uuid, created_at FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ history: rows.map(r => ({ ...r, image_urls: r.image_urls ? JSON.parse(r.image_urls) : [] })) });
  } catch (err) {
    res.status(500).json({ error: 'Errore storico' });
  }
});
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, email, avatar, plan, monthly_generations, monthly_reset, created_at, stripe_customer_id, stripe_subscription_id, subscription_status FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });
    const user = users[0];
    const limit = PLAN_LIMITS[user.plan || 'free'];
    const remaining = Math.max(0, limit - (user.monthly_generations || 0));
    // Reset solo al cambio mese (confronto anno-mese, non giorno)
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const resetMonth = user.monthly_reset ? user.monthly_reset.slice(0, 7) : null;
    const genRemaining = (resetMonth !== thisMonth) ? limit : remaining;
    res.json({ user: { ...user, monthly_limit: limit, remaining: genRemaining } });
  } catch (err) {
    res.status(500).json({ error: 'Errore profilo' });
  }
});

// ── Helper: extract title from AI description ────────────────────
// AI returns: 🏡 TITOLO ACCATTIVANTE\n\n📝 DESCRIZIONE...
function extractTitle(description, property) {
  if (!description) return null;
  // Match text after 🏡 until the next emoji section header or double newline
  const match = description.match(/🏡\s*(.+?)(?:\n\n📝|\n📝|$)/s);
  let title = null;
  if (match && match[1]) {
    title = match[1].trim().replace(/\n/g, ' ').substring(0, 200);
  } else {
    // Fallback: try to get the first meaningful line
    title = description.split('\n')[0].replace(/^[🏡📝📍🏷️📞]\s*/, '').trim();
  }
  
  // If title is too long or looks like a sentence (has verbs/commas that suggest description), build one from data
  if (title && title.length < 120 && !title.includes('questo') && !title.includes('splendido') && !title.includes('situato')) {
    return title;
  }
  
  // Build title from property data: "Appartamento a/in Roma" etc.
  if (property) {
    const t = property.property_type || 'immobile';
    const typeLabel = { apartment:'Appartamento', villa:'Villa', townhouse:'Schiera', attic:'Attico', studio:'Monolocale', office:'Ufficio', commercial:'Negozio', land:'Terreno', warehouse:'Magazzino', garage:'Box', building:'Fabbricato' }[t] || t;
    const city = property.city || '';
    const zone = property.zone || '';
    const location = city || zone;
    const preposition = location ? (' in ' + location) : '';
    return (typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)) + preposition;
  }
  
  return title ? title.substring(0, 100) : null;
}

// ── Helper: generate URL-friendly slug ─────────────────────────────
function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

// ── Helper: check generations limit ──────────────────────────────
const PLAN_LIMITS = { free: 3, base: 50, pro: 9999 };

// Plan-specific AI generation config
const PLAN_CONFIG = {
  free:  { maxPhotos: 5,  maxTokens: 2048, wordLimit: 400 },
  base:  { maxPhotos: 5,  maxTokens: 2048, wordLimit: 400 },
  pro:   { maxPhotos: 10, maxTokens: 4096, wordLimit: 800 },
};

async function checkGenerationLimit(userId, plan) {
  const [rows] = await pool.query(
    'SELECT monthly_generations, monthly_reset FROM users WHERE id = ?',
    [userId]
  );
  if (rows.length === 0) return { allowed: false, remaining: 0 };

  const { monthly_generations, monthly_reset } = rows[0];
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const resetMonth = monthly_reset ? monthly_reset.slice(0, 7) : null;
  const limit = PLAN_LIMITS[plan] || 3;

  // Reset mensile (solo al cambio mese, non ogni giorno)
  if (resetMonth !== thisMonth) {
    await pool.query(
      'UPDATE users SET monthly_generations = 0, monthly_reset = ? WHERE id = ?',
      [today, userId]
    );
    return { allowed: true, remaining: limit };
  }

  const remaining = Math.max(0, limit - monthly_generations);
  return { allowed: remaining > 0, remaining };
}

// ── Analyze Route (protetto) ─────────────────────────────────────
app.post('/analyze', aiLimiter, authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto' });
    }

    const plan = req.user.plan || 'free';
    const maxPhotos = (PLAN_CONFIG[plan] || PLAN_CONFIG.free).maxPhotos;
    if (req.files.length > maxPhotos) {
      return res.status(400).json({ error: `Il piano ${plan} permette al massimo ${maxPhotos} foto. Passa a Pro per caricarne fino a 10.` });
    }

    // Comprimi e ottimizza immagini
    await processUploadedFiles(req.files);

    // Check limit
    const limitCheck = await checkGenerationLimit(req.user.id, plan);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Hai raggiunto il limite di ${PLAN_LIMITS[req.user.plan || 'free']} descrizioni gratuite. Passa a un piano a pagamento per continuare.`,
        remaining: 0,
      });
    }

    const result = await describeProperty(req.files.map((f) => f.path), 'it', plan);
    if (result.error) return res.status(500).json(result);

    // Increment counter
    await pool.query(
      'UPDATE users SET monthly_generations = monthly_generations + 1 WHERE id = ?',
      [req.user.id]
    );

    // Inject contacts from user profile into the AI description
    const finalDescription = injectContacts(result.description, {
      agent_name: req.user.name,
      agent_email: req.user.email,
      agent_phone: null,
    });

    // Save to history
    const imageUrls = req.files.map((f) => `/media/uploads/${path.basename(f.path)}`);
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
    logger.error('Analyze error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// ── Chatbot ───────────────────────────────────────────────────────
const CHAT_MODEL = process.env.CHAT_MODEL || 'deepseek/deepseek-chat';

const CHAT_SYSTEM = `Sei un assistente virtuale di DescriviCasa.it, un servizio che genera descrizioni immobiliari professionali tramite AI.

Il servizio funziona così:
- L'utente carica fino a 5 foto di un immobile (10 per il piano Pro)
- L'AI analizza le foto e genera una descrizione professionale in italiano
- Le descrizioni sono adatte per Idealista, Immobiliare.it, Casa.it

PREZZI:
- Free: 3 descrizioni gratis al mese
- Base: €9/mese, 50 descrizioni, 5 foto per descrizione
- Pro: €29/mese, illimitate, 10 foto per descrizione, API
Tutti i piani includono l'esportazione PDF gratuita delle descrizioni.

DOMANDE TECNICHE:
- Serve solo un account email o Google per registrarsi
- Le foto vengono cancellate automaticamente dopo 4 ore
- Si può usare da qualsiasi dispositivo (smartphone, tablet, PC)

Rispondi in italiano, sii gentile e professionale. Se non sai qualcosa, indirizza l'utente alla email di supporto.`;

app.post('/api/chat', aiLimiter, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invia almeno un messaggio' });
    }

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
        messages: [
          { role: 'system', content: CHAT_SYSTEM },
          ...messages.slice(-20), // ultimi 20 messaggi per contesto
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      return res.status(500).json({ error: 'Errore del chatbot' });
    }

    const data = await resp.json();
    res.json({ reply: data.choices[0].message.content, model: data.model });
  } catch (err) {
    logger.error('Chat error:', err);
    res.status(500).json({ error: 'Errore del chatbot' });
  }
});
// ── Property-aware description generator ──────────────────────────
function buildPropertyPrompt(property) {
  const t = property.property_type || 'immobile';
  const contract = property.contract_type === 'rent' ? 'affitto' : 'vendita';
  return `Analizza attentamente queste foto e scrivi una descrizione professionale completa per questo ${t} in ${contract}, seguendo la STRUTTURA OBBLIGATORIA: TITOLO, DESCRIZIONE in paragrafi, ZONA, CARATTERISTICHE CHIAVE in elenco puntato, CONTATTI. Non aggiungere preamboli. Produci solo la descrizione dell'annuncio. Se tra le immagini c'è una planimetria o un disegno tecnico, ignorarlo: descrivi solo le foto reali.

DATI DELL'IMMOBILE (integrarli nella descrizione):
${property.address ? `- Indirizzo: ${property.address}${property.civic ? ', ' + property.civic : ''}${property.city ? ', ' + property.city : ''}${property.province ? ' (' + property.province + ')' : ''}` : ''}
${property.surface ? `- Superficie: ${property.surface} mq` : ''}
${property.rooms ? `- Locali: ${property.rooms}` : ''}
${property.bedrooms ? `- Camere: ${property.bedrooms}` : ''}
${property.bathrooms ? `- Bagni: ${property.bathrooms}` : ''}
${property.floor !== null && property.floor !== undefined ? `- Piano: ${property.floor}${property.total_floors ? '/' + property.total_floors : ''}${property.elevator ? ' con ascensore' : ''}` : ''}
${property.building_state ? `- Stato: ${property.building_state}` : ''}
${property.energy_class ? `- Classe energetica: ${property.energy_class}${property.energy_index ? ' (' + property.energy_index + ')' : ''}` : ''}
${property.heating ? `- Riscaldamento: ${property.heating}` : ''}
${property.balcony_sqm ? `- Balcone/Terrazzo: ${property.balcony_sqm} mq` : ''}
${property.garden_sqm ? `- Giardino: ${property.garden_sqm} mq` : ''}
${property.parking ? '- Posto auto: sì' : ''}
${property.air_conditioning ? '- Condizionamento: sì' : ''}
${property.furnished && property.furnished !== 'no' ? `- Arredato: ${property.furnished}` : ''}
${property.year_built ? `- Anno di costruzione: ${property.year_built}` : ''}
${property.price ? `- Prezzo: € ${Number(property.price).toLocaleString('it-IT')}${contract === 'affitto' ? '/mese' : ''}` : ''}
${property.agent_name ? `\nCONTATTI DA INSERIRE NELLA SEZIONE 📞:\n- Nome: ${property.agent_name}` : ''}${property.agent_phone ? `\n- Telefono: ${property.agent_phone}` : ''}${property.agent_email ? `\n- Email: ${property.agent_email}` : ''}

Intreccia questi dati nella descrizione in modo naturale, non fare un semplice elenco. La descrizione deve sembrare scritta da un'agenzia immobiliare professionista.`;
}

async function describePropertyWithData(imagePaths, propertyData, plan = 'free') {
  const cfg = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const systemContent = SYSTEM_PROMPT.replace(/Non superare le \d+ parole in totale/, `Non superare le ${cfg.wordLimit} parole in totale`);
  return callVisionAPI(imagePaths, systemContent, buildPropertyPrompt(propertyData), { maxTokens: cfg.maxTokens });
}

// ── Helper: inject contact info into description, replacing AI-generated contacts ──
// Strips the 📞 CONTATTI section from the AI output and replaces it with real contacts.
function injectContacts(description, property) {
  if (!description) return description;
  
  // Build the contacts section with real data
  const agentName = property.agent_name || null;
  const agentPhone = property.agent_phone || null;
  const agentEmail = property.agent_email || null;
  
  let contactsText = '📞 CONTATTI\n';
  if (agentPhone || agentEmail) {
    if (agentPhone) contactsText += `- Tel: ${agentPhone}\n`;
    if (agentEmail) contactsText += `- Email: ${agentEmail}\n`;
  }
  
  // Strip the AI-generated 📞 CONTATTI section (from 📞 to end of text, or to next section if present)
  // The AI output looks like: ...\n📞 CONTATTI\nsome text...\n (possibly followed by nothing)
  const contactsRegex = /\n?📞\s*CONTATTI[\s\S]*$/;
  let cleaned = description.replace(contactsRegex, '').trimEnd();
  
  // Append the real contacts section
  cleaned += '\n\n' + contactsText;
  
  return cleaned;
}

// ── Properties CRUD ───────────────────────────────────────────────

// Create property
app.post('/api/properties', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : (req.body.data || req.body);
    const uuid = crypto.randomUUID();
    const photoUrls = req.files ? req.files.map(f => `/media/uploads/${path.basename(f.path)}`) : [];

    // Comprimi e ottimizza immagini
    await processUploadedFiles(req.files);

    await pool.query(`
      INSERT INTO properties (
        uuid, user_id, contract_type, property_type,
        address, civic, cap, city, province, zone, latitude, longitude,
        surface, rooms, bedrooms, bathrooms, floor, total_floors, elevator,
        building_state, year_built, energy_class, energy_index, heating, air_conditioning,
        exposure, balcony_sqm, garden_sqm, parking, basement, furnished,
        price, condo_fees, agent_name, agent_phone, agent_email, photos, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuid, req.user.id, data.contract_type || 'sell', data.property_type || 'apartment',
      data.address || null, data.civic || null, data.cap || null, data.city || null,
      data.province || null, data.zone || null, data.latitude || null, data.longitude || null,
      data.surface || null, data.rooms || null, data.bedrooms || null, data.bathrooms || null,
      data.floor ?? null, data.total_floors || null, data.elevator ? 1 : 0,
      data.building_state || null, data.year_built || null, data.energy_class || null,
      data.energy_index || null, data.heating || null, data.air_conditioning ? 1 : 0,
      data.exposure || null, data.balcony_sqm || null, data.garden_sqm || null,
      data.parking ? 1 : 0, data.basement ? 1 : 0, data.furnished || 'no',
      data.price || null, data.condo_fees || null,
      data.agent_name || null, data.agent_phone || null, data.agent_email || null,
      photoUrls.length > 0 ? JSON.stringify(photoUrls) : null,
      data.status || 'draft',
    ]);

    res.status(201).json({ uuid, message: 'Immobile creato' });
  } catch (err) {
    logger.error('Create property error:', err);
    res.status(500).json({ error: 'Errore creazione immobile' });
  }
});

// List user's properties
app.get('/api/properties', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, contract_type, property_type, address, city, province, surface, rooms, bathrooms, price, status, is_public, title, photos, description IS NOT NULL AS has_description, created_at, updated_at FROM properties WHERE user_id = ? ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json({ properties: rows });
  } catch (err) {
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get single property
app.get('/api/properties/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM properties WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });
    const p = rows[0];
    p.photos = p.photos || [];
    p.elevator = !!p.elevator;
    p.air_conditioning = !!p.air_conditioning;
    p.parking = !!p.parking;
    p.basement = !!p.basement;
    p.is_public = !!p.is_public;
    res.json({ property: p });
  } catch (err) {
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Update property
app.put('/api/properties/:id', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : (req.body.data || req.body);
    const existing = await pool.query('SELECT photos FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (existing[0].length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    // Validate contact fields if provided
    if (data.agent_phone && !/^(\+?\d{1,3}[-\s]?)?\d{6,15}$/.test(data.agent_phone)) {
      return res.status(400).json({ error: 'Numero di telefono non valido' });
    }
    if (data.agent_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.agent_email)) {
      return res.status(400).json({ error: 'Email non valida' });
    }

    let existingPhotos = [];
    try { existingPhotos = existing[0][0].photos || []; } catch (_) {}

    if (req.files && req.files.length > 0) {
      // Comprimi e ottimizza immagini
      await processUploadedFiles(req.files);
      const newPhotos = req.files.map(f => `/media/uploads/${path.basename(f.path)}`);
      existingPhotos = [...existingPhotos, ...newPhotos];
    }

    await pool.query(`
      UPDATE properties SET
        contract_type=?, property_type=?, address=?, civic=?, cap=?, city=?,
        province=?, zone=?, latitude=?, longitude=?, surface=?, rooms=?,
        bedrooms=?, bathrooms=?, floor=?, total_floors=?, elevator=?,
        building_state=?, year_built=?, energy_class=?, energy_index=?,
        heating=?, air_conditioning=?, exposure=?, balcony_sqm=?, garden_sqm=?,
        parking=?, basement=?, furnished=?, price=?, condo_fees=?,
        agent_name=?, agent_phone=?, agent_email=?, photos=?,
        status=?, title=?, description=?
      WHERE id=? AND user_id=?
    `, [
      data.contract_type || 'sell', data.property_type || 'apartment',
      data.address !== undefined ? data.address : null,
      data.civic !== undefined ? data.civic : null,
      data.cap !== undefined ? data.cap : null,
      data.city !== undefined ? data.city : null,
      data.province !== undefined ? data.province : null,
      data.zone !== undefined ? data.zone : null,
      data.latitude !== undefined ? data.latitude : null,
      data.longitude !== undefined ? data.longitude : null,
      data.surface !== undefined ? data.surface : null,
      data.rooms !== undefined ? data.rooms : null,
      data.bedrooms !== undefined ? data.bedrooms : null,
      data.bathrooms !== undefined ? data.bathrooms : null,
      data.floor ?? null, data.total_floors !== undefined ? data.total_floors : null,
      data.elevator ? 1 : 0,
      data.building_state !== undefined ? data.building_state : null,
      data.year_built !== undefined ? data.year_built : null,
      data.energy_class !== undefined ? data.energy_class : null,
      data.energy_index !== undefined ? data.energy_index : null,
      data.heating !== undefined ? data.heating : null,
      data.air_conditioning ? 1 : 0,
      data.exposure !== undefined ? data.exposure : null,
      data.balcony_sqm !== undefined ? data.balcony_sqm : null,
      data.garden_sqm !== undefined ? data.garden_sqm : null,
      data.parking ? 1 : 0, data.basement ? 1 : 0, data.furnished || 'no',
      data.price !== undefined ? data.price : null,
      data.condo_fees !== undefined ? data.condo_fees : null,
      data.agent_name !== undefined ? data.agent_name : null,
      data.agent_phone !== undefined ? data.agent_phone : null,
      data.agent_email !== undefined ? data.agent_email : null,
      existingPhotos.length > 0 ? JSON.stringify(existingPhotos) : null,
      data.status || 'draft',
      data.title !== undefined ? data.title : null,
      data.description !== undefined ? data.description : null,
      req.params.id, req.user.id,
    ]);

    res.json({ message: 'Immobile aggiornato' });
  } catch (err) {
    logger.error('Update property error:', err);
    res.status(500).json({ error: 'Errore aggiornamento' });
  }
});

// Delete property
app.delete('/api/properties/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Immobile eliminato' });
  } catch (err) {
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Generate description for a property (with photos + data)
app.post('/api/properties/:id/generate', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    const property = rows[0];
    let photos = property.photos || [];

    // If new files uploaded, add them
    if (req.files && req.files.length > 0) {
      // Comprimi e ottimizza immagini
      await processUploadedFiles(req.files);
      const newPhotos = req.files.map(f => `/media/uploads/${path.basename(f.path)}`);
      photos = [...photos, ...newPhotos];
    }

    if (photos.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto per generare la descrizione' });
    }

    const plan = req.user.plan || 'free';
    const maxPhotos = (PLAN_CONFIG[plan] || PLAN_CONFIG.free).maxPhotos;
    // Check total photos don't exceed plan limit
    if (photos.length > maxPhotos) {
      return res.status(400).json({ error: `Il piano ${plan} permette al massimo ${maxPhotos} foto. Passa a Pro per averne fino a 10.` });
    }

    // Check generation limit
    const limitCheck = await checkGenerationLimit(req.user.id, plan);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Hai raggiunto il limite di ${PLAN_LIMITS[req.user.plan || 'free']} descrizioni gratuite.`,
        remaining: 0,
      });
    }

    // Convert photo URLs to local file paths (use UPLOAD_DIR, not __dirname/uploads)
    const filePaths = photos.map(url => path.join(UPLOAD_DIR, path.basename(url))).filter(fs.existsSync);
    logger.info({ photosCount: photos.length, filePathsCount: filePaths.length, filesInRequest: req.files ? req.files.length : 0 }, 'Generate: photo resolution');

    // Load contact info from property, fall back to user profile
    const propertyWithContacts = {
      ...property,
      agent_name: property.agent_name || req.user.name,
      agent_phone: property.agent_phone || null,
      agent_email: property.agent_email || req.user.email,
    };

    const result = await describePropertyWithData(filePaths, propertyWithContacts, plan);
    if (result.error) {
      logger.error({ error: result.error }, 'Generate: describePropertyWithData returned error');
      return res.status(500).json(result);
    }
    logger.info({ descLength: result.description ? result.description.length : 0, model: result.model }, 'Generate: AI response received');

    // Inject real contact info into the AI description (replace AI-generated contacts)
    const finalDescription = injectContacts(result.description, propertyWithContacts);

    // Increment counter
    await pool.query('UPDATE users SET monthly_generations = monthly_generations + 1 WHERE id = ?', [req.user.id]);

    // Save to history
    await pool.query(
      'INSERT INTO generations (user_id, description, image_urls, model, property_uuid) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, finalDescription, JSON.stringify(photos), result.model || '', property.uuid]
    ).catch(() => {});

    // Extract title from AI-generated description
    const title = extractTitle(finalDescription, propertyWithContacts);

    // Update property with description and title
    await pool.query('UPDATE properties SET description = ?, title = ?, ai_model = ?, photos = ?, status = ? WHERE id = ?',
      [finalDescription, title, result.model || '', JSON.stringify(photos), 'published', req.params.id]);

    res.json({
      description: finalDescription,
      title,
      model: result.model || '',
      photos,
      remaining: limitCheck.remaining - 1,
      propertyId: req.params.id,
      uuid: property.uuid,
    });
  } catch (err) {
    logger.error({ message: err.message, stack: err.stack?.slice(0, 300), code: err.code, name: err.name }, 'Generate error');
    res.status(500).json({ error: 'Errore generazione' });
  }
});

// Public property page (no auth required)
app.get('/api/p/:uuid', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS user_name, u.email AS user_email, u.avatar AS agent_avatar
       FROM properties p JOIN users u ON p.user_id = u.id
       WHERE p.uuid = ? AND p.is_public = TRUE AND p.status IN ('published','draft')`,
      [req.params.uuid]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    const p = rows[0];
    // Prefer property-level contact info over user profile
    p.agent_name = p.agent_name || p.user_name;
    p.agent_email = p.agent_email || p.user_email;
    p.agent_phone = p.agent_phone || null;
    p.photos = p.photos || [];
    p.elevator = !!p.elevator;
    p.air_conditioning = !!p.air_conditioning;
    p.parking = !!p.parking;
    p.basement = !!p.basement;
    p.is_public = true;

    // Re-inject contacts into description so edits (phone/email) are reflected
    if (p.description) {
      p.description = injectContacts(p.description, p);
    }

    res.json({ property: p });
  } catch (err) {
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PDF download — available to all users, no auth required
app.get('/api/p/:uuid/pdf', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS user_name, u.email AS user_email
       FROM properties p JOIN users u ON p.user_id = u.id
       WHERE p.uuid = ? AND p.is_public = TRUE AND p.status IN ('published','draft')`,
      [req.params.uuid]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    const p = rows[0];
    p.agent_name = p.agent_name || p.user_name;
    p.agent_email = p.agent_email || p.user_email;
    p.agent_phone = p.agent_phone || null;
    let description = p.description || '';
    if (description) {
      // Pulisci emoji e caratteri speciali non supportati dai font PDF
      description = cleanForPdf(description);
      description = injectContacts(description, p);
    }

    const title = p.title || `${propertyTypeLabel(p.property_type)}${p.city ? ' in ' + p.city : ''}`;
    const priceText = p.contract_type === 'rent'
      ? `€ ${Number(p.price || 0).toLocaleString('it-IT')}/mese`
      : `€ ${Number(p.price || 0).toLocaleString('it-IT')}`;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="descrizione-${p.uuid}.pdf"`);
    doc.pipe(res);

    // Colors
    const primary = '#667eea';
    const dark = '#1d1d1f';
    const grey = '#86868b';
    const lightBg = '#f5f5f7';

    // Footer on every page (via event instead of bufferPages/switchToPage)
    doc.on('pageAdded', () => {
      const savedFont = doc._font;
      const savedSize = doc._fontSize;
      const savedFill = doc._fillColor;
      doc.fontSize(8).font('Helvetica').fillColor(grey)
         .text(
           `DescriviCasa.it — Generato con AI il ${new Date().toLocaleDateString('it-IT')}`,
           50, doc.page.height - 40,
           { align: 'center', width: 495 }
         );
      // Ripristina stato precedente
      if (savedFont) doc.font(savedFont);
      if (savedSize) doc.fontSize(savedSize);
      if (savedFill) doc.fillColor(savedFill);
    });

    // Header
    doc.fontSize(22).font('Helvetica-Bold').fillColor(primary)
       .text('DescriviCasa.it', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(grey)
       .text('Descrizione Immobiliare Professionale', { align: 'center' });
    doc.moveDown(0.5);

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(primary).lineWidth(1).stroke();
    doc.moveDown(0.8);

    // Title + Price
    doc.fontSize(18).font('Helvetica-Bold').fillColor(dark).text(title, { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(primary).text(priceText);
    doc.moveDown(0.3);

    // Address
    const addrParts = [p.address, p.city, p.province].filter(Boolean);
    if (addrParts.length > 0) {
      doc.fontSize(10).font('Helvetica').fillColor(grey).text(addrParts.join(', '));
    }
    doc.moveDown(0.6);

    // Features box
    doc.roundedRect(50, doc.y, 495, 10, 4).fill(lightBg);
    doc.moveDown(0.3);

    const features = [
      p.surface ? `Superficie: ${p.surface} mq` : null,
      p.rooms ? `Locali: ${p.rooms}` : null,
      p.bedrooms ? `Camere: ${p.bedrooms}` : null,
      p.bathrooms ? `Bagni: ${p.bathrooms}` : null,
      p.energy_class ? `Classe energetica: ${p.energy_class}` : null,
      p.building_state ? `Stato: ${p.building_state}` : null,
      p.heating ? `Riscaldamento: ${p.heating}` : null,
      p.furnished && p.furnished !== 'no' ? `Arredato: ${p.furnished}` : null,
      p.floor !== null && p.floor !== undefined ? `Piano: ${p.floor}${p.total_floors ? '/' + p.total_floors : ''}` : null,
    ].filter(Boolean);

    if (features.length > 0) {
      const colWidth = 230;
      const startY = doc.y;
      features.forEach((f, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const bx = 50 + col * (colWidth + 35);
        const by = startY + row * 18;
        doc.fontSize(9).font('Helvetica').fillColor(dark).text(`• ${f}`, bx, by, { width: colWidth });
      });
      doc.moveDown(features.length > 1 ? Math.ceil(features.length / 2) * 0.8 + 0.3 : 0.8);
    }

    // Divider
    doc.moveTo(50, doc.y + 5).lineTo(545, doc.y + 5).strokeColor('#e8e8ed').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // Photos
    let photoPaths = [];
    try {
      const rawPhotos = p.photos || '[]';
      const photos = typeof rawPhotos === 'string' ? JSON.parse(rawPhotos) : rawPhotos;
      photoPaths = photos.map(url => path.join(UPLOAD_DIR, path.basename(url))).filter(fs.existsSync);
    } catch (_) {}

    if (photoPaths.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(dark).text('Galleria');
      doc.moveDown(0.4);
      const imgW = 235;   // larghezza immagine nel PDF
      const imgH = 155;   // altezza fissa per griglia uniforme
      const gap = 25;     // spazio tra colonne
      let imgY = doc.y;
      for (let i = 0; i < photoPaths.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const ix = 50 + col * (imgW + gap);
        const iy = imgY + row * (imgH + 12);
        // Nuova pagina se non c'è spazio per la riga
        if (iy + imgH > doc.page.height - 55) {
          doc.addPage();
          imgY = doc.y;
          const newRow = Math.floor(i / 2);
          const newIy = imgY + newRow * (imgH + 12);
          const newIx = 50 + (i % 2) * (imgW + gap);
          const imgBuf = await resizeForPdf(photoPaths[i]);
          if (imgBuf) doc.image(imgBuf, newIx, newIy, { width: imgW, height: imgH });
        } else {
          const imgBuf = await resizeForPdf(photoPaths[i]);
          if (imgBuf) doc.image(imgBuf, ix, iy, { width: imgW, height: imgH });
        }
      }
      // Avanza y oltre le immagini
      const rows = Math.ceil(photoPaths.length / 2);
      doc.y = imgY + rows * (imgH + 12) + 8;
    }

    // Description
    doc.fontSize(12).font('Helvetica-Bold').fillColor(dark).text('Descrizione');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#333').text(description || 'Descrizione in preparazione.', {
      lineGap: 4,
      align: 'justify',
    });
    doc.moveDown(0.8);

    doc.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Errore interno del server' });
    }
  }
});

// Serve public property pages (with optional SEO-friendly slug)
app.get('/p/:uuid', (req, res) => {
  res.sendFile(path.join(__dirname, 'property.html'));
});
app.get('/p/:uuid/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'property.html'));
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err.stack || err.message);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Richiesta non valida' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File troppo grande. Massimo 20MB.' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Troppi file caricati' });
  }
  res.status(500).json({ error: 'Errore interno del server' });
});

// ── Helper: pulisci emoji e caratteri non-latini per rendering PDF ──
function cleanForPdf(text) {
  if (!text) return '';
  // Rimuovi emoji e simboli non stampabili (mantieni caratteri latini, numeri, punteggiatura, e accenti italiani)
  let cleaned = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}\u{3299}\u{3297}\u{3030}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{2139}\u{24C2}\u{2934}\u{2935}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{260E}\u{2611}\u{2614}\u{2615}\u{261D}\u{2620}\u{2622}\u{2623}\u{2626}\u{262A}\u{262E}\u{262F}\u{2638}-\u{263A}\u{2640}\u{2642}\u{2648}-\u{2653}\u{265F}\u{2660}\u{2663}\u{2665}\u{2666}\u{2668}\u{267B}\u{267E}\u{267F}\u{2692}-\u{2697}\u{2699}\u{269B}\u{269C}\u{26A0}\u{26A1}\u{26A7}\u{26AA}\u{26AB}\u{26B0}\u{26B1}\u{26BD}\u{26BE}\u{26C4}\u{26C5}\u{26C8}\u{26CE}\u{26CF}\u{26D1}\u{26D3}\u{26D4}\u{26E9}\u{26EA}\u{26F0}-\u{26F5}\u{26F7}-\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{231A}\u{231B}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}]/gu, '');
  // Pulisci spazi multipli e linee vuote triple generate dalla rimozione emoji
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/^[ \t]+/gm, '');
  return cleaned.trim();
}

// ── Helper ──────────────────────────────────────────────────────────
function propertyTypeLabel(t) {
  const labels = {
    apartment: 'Appartamento', villa: 'Villa', townhouse: 'Schiera',
    loft: 'Loft', penthouse: 'Attico', studio: 'Monolocale',
    office: 'Ufficio', commercial: 'Negozi e locali', land: 'Terreno',
    warehouse: 'Magazzino', garage: 'Box auto', building: 'Fabbricato',
  };
  return labels[t] || t;
}

// ── Stripe Checkout ────────────────────────────────────────────────

// Restituisce la chiave pubblica Stripe al client
app.get('/api/stripe-public-key', (req, res) => {
  if (!STRIPE_PUBLIC_KEY) return res.status(500).json({ error: 'Stripe non configurato' });
  res.json({ publicKey: STRIPE_PUBLIC_KEY });
});

// Crea una sessione di checkout Stripe (o fa upgrade/downgrade se subscription già attiva)
app.post('/api/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe non configurato. Controlla STRIPE_SECRET_KEY nel .env' });

    const { plan, successUrl, cancelUrl } = req.body;
    if (!plan || !['base', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Piano non valido. Scegli base o pro.' });
    }

    const priceId = plan === 'base' ? STRIPE_PRICE_ID_BASE : STRIPE_PRICE_ID_PRO;
    if (!priceId) {
      return res.status(500).json({ error: `Price ID non configurato per il piano ${plan}.` });
    }

    // Recupera utente + eventuale customer Stripe
    const [users] = await pool.query(
      'SELECT id, email, name, stripe_customer_id, plan AS current_plan FROM users WHERE id = ?',
      [req.user.id]
    );
    if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

    const user = users[0];
    let customerId = user.stripe_customer_id;

    // Se l'utente ha già un customer Stripe, cerca subscription attiva
    if (customerId) {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
        limit: 1,
      });

      if (subs.data.length > 0) {
        const sub = subs.data[0];

        // Stesso piano? Nulla da fare
        if (user.current_plan === plan) {
          return res.status(400).json({ error: `Sei già sul piano ${plan === 'base' ? 'Base' : 'Pro'}.` });
        }

        // Determina se è upgrade o downgrade
        const currentLimit = PLAN_LIMITS[user.current_plan] || 0;
        const newLimit = PLAN_LIMITS[plan] || 0;
        const isUpgrade = newLimit > currentLimit;

        // Aggiorna la subscription esistente
        const updatedSub = await stripe.subscriptions.update(sub.id, {
          items: [{ id: sub.items.data[0].id, price: priceId }],
          proration_behavior: isUpgrade ? 'always_invoice' : 'none',
          metadata: { userId: String(req.user.id), plan },
        });

        if (isUpgrade) {
          // Upgrade: aggiorna piano nel DB subito
          try {
            await pool.query(
              'UPDATE users SET plan = ?, stripe_subscription_id = ?, subscription_status = ? WHERE id = ?',
              [plan, sub.id, updatedSub.status, req.user.id]
            );
          } catch (_) {
            await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, req.user.id]);
          }
          const limit = newLimit;
          logger.info(`⬆️ User ${req.user.id} upgraded from ${user.current_plan} to ${plan}`);
          return res.json({ upgraded: true, plan, monthly_limit: limit, remaining: limit });
        } else {
          // Downgrade: piano attivo fino a scadenza, il cambio avviene al prossimo rinnovo
          logger.info(`🔜 User ${req.user.id} downgrade scheduled: ${user.current_plan} → ${plan} (al prossimo rinnovo)`);
          return res.json({
            upgraded: false,
            scheduled: true,
            plan: user.current_plan,      // piano attuale (ancora attivo)
            future_plan: plan,            // piano che partirà al rinnovo
            monthly_limit: currentLimit,
            remaining: currentLimit,
            message: `Passaggio a ${plan === 'base' ? 'Base' : 'Pro'} programmato. Il tuo piano ${user.current_plan === 'pro' ? 'Pro' : 'Base'} resta attivo fino alla scadenza.`
          });
        }
      }
    }

    // Primo acquisto (o ri-acquisto dopo cancellazione): crea customer se serve
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: String(req.user.id) },
      });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, req.user.id]);
      logger.info(`✅ Stripe customer created: ${customerId} for user ${req.user.id}`);
    }

    // Crea sessione checkout per nuovo abbonamento
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: { metadata: { userId: String(req.user.id), plan } },
      success_url: successUrl || 'https://descrivicasa.it/?subscribed=' + plan,
      cancel_url: cancelUrl || 'https://descrivicasa.it/pricing',
      metadata: { userId: String(req.user.id), plan },
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Errore creazione sessione di pagamento' });
  }
});

// Sincronizza il piano dopo il redirect da Stripe (fallback se webhook in ritardo)
// Accetta optionalmente {plan} dal client per forzare il piano corretto
app.post('/api/sync-subscription', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' });

    const [users] = await pool.query(
      'SELECT id, plan, stripe_customer_id FROM users WHERE id = ?',
      [req.user.id]
    );
    if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

    const user = users[0];
    const requestedPlan = req.body?.plan; // piano richiesto dal client (da ?subscribed=X)

    // Se non ha customer_id Stripe, upgrade diretto se il piano è valido
    if (!user.stripe_customer_id) {
      if (requestedPlan && ['base', 'pro'].includes(requestedPlan) && user.plan !== requestedPlan) {
        try {
          await pool.query('UPDATE users SET plan = ? WHERE id = ?', [requestedPlan, user.id]);
        } catch (_) { /* fallback silenzioso */ }
        const limit = PLAN_LIMITS[requestedPlan] || 3;
        return res.json({ plan: requestedPlan, synced: true, monthly_limit: limit, remaining: limit });
      }
      return res.json({ plan: user.plan, synced: false, reason: 'no_stripe_customer' });
    }

    // Cerca subscription attive per questo customer
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripe_customer_id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length > 0) {
      const sub = subscriptions.data[0];
      // Piano dal metadata subscription o dal parametro client
      const planFromMeta = sub.metadata?.plan || requestedPlan;
      if (planFromMeta && ['base', 'pro'].includes(planFromMeta) && user.plan !== planFromMeta) {
        // Aggiorna piano
        try {
          await pool.query(
            'UPDATE users SET plan = ?, stripe_subscription_id = ?, subscription_status = ? WHERE id = ?',
            [planFromMeta, sub.id, 'active', user.id]
          );
        } catch (_) {
          await pool.query('UPDATE users SET plan = ? WHERE id = ?', [planFromMeta, user.id]);
        }
        const limit = PLAN_LIMITS[planFromMeta] || 3;
        return res.json({ plan: planFromMeta, synced: true, monthly_limit: limit, remaining: limit });
      }
      return res.json({ plan: user.plan, synced: false, reason: 'already_synced' });
    }

    // Nessuna subscription attiva, ma il client ha richiesto un upgrade
    if (requestedPlan && ['base', 'pro'].includes(requestedPlan) && user.plan !== requestedPlan) {
      try {
        await pool.query('UPDATE users SET plan = ? WHERE id = ?', [requestedPlan, user.id]);
      } catch (_) {}
      const limit = PLAN_LIMITS[requestedPlan] || 3;
      return res.json({ plan: requestedPlan, synced: true, monthly_limit: limit, remaining: limit });
    }

    // Nessuna subscription attiva: downgrade a free se l'utente è su un piano a pagamento
    if (user.plan !== 'free') {
      try {
        await pool.query(
          'UPDATE users SET plan = "free", stripe_subscription_id = NULL, subscription_status = NULL WHERE id = ?',
          [user.id]
        );
      } catch (_) {
        await pool.query('UPDATE users SET plan = "free" WHERE id = ?', [user.id]);
      }
      logger.info(`⬇️ User ${user.id} downgraded to free (no active subscriptions)`);
      return res.json({ plan: 'free', synced: true, monthly_limit: 3, remaining: 3 });
    }

    return res.json({ plan: user.plan, synced: false, reason: 'no_active_subscription' });
  } catch (err) {
    logger.error('Sync subscription error:', err);
    res.status(500).json({ error: 'Errore sincronizzazione abbonamento' });
  }
});

// Stripe Customer Portal: gestione abbonamento (cancella, aggiorna pagamento, fatture)
app.post('/api/customer-portal', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' });

    const [users] = await pool.query(
      'SELECT id, stripe_customer_id, plan FROM users WHERE id = ?',
      [req.user.id]
    );
    if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

    const user = users[0];
    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: 'Nessun abbonamento attivo da gestire' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: req.body.returnUrl || 'https://descrivicasa.it/',
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    logger.error('Customer portal error:', err);
    res.status(500).json({ error: 'Errore apertura portale' });
  }
});

// ── Debug DB connection ───────────────────────────────────────────
app.get('/api/debug-db', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT 1 AS test');
    conn.release();
    res.json({ db: 'ok', test: rows[0].test });
  } catch (err) {
    res.json({ db: 'error', message: err.message, code: err.code });
  }
});

// ── Serve HTML routes ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'pricing.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});
app.get('/termini', (req, res) => {
  res.sendFile(path.join(__dirname, 'termini.html'));
});
app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'robots.txt'));
});

// Sitemap dinamica — elenca tutte le proprietà pubbliche
function slugify(text) {
  return (text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

app.get('/sitemap.xml', async (req, res) => {
  try {
    const base = 'https://descrivicasa.it';

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    xml += '  <url>\n';
    xml += '    <loc>' + base + '/</loc>\n';
    xml += '    <changefreq>weekly</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';
    xml += '  <url>\n';
    xml += '    <loc>' + base + '/pricing</loc>\n';
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.8</priority>\n';
    xml += '  </url>\n';

    // Dynamic: public properties
    if (pool) {
      const [rows] = await pool.query(
        "SELECT uuid, title, updated_at FROM properties WHERE is_public = TRUE AND status = 'published' ORDER BY updated_at DESC"
      );
      for (const p of rows) {
        const slug = slugify(p.title);
        const loc = slug ? base + '/p/' + p.uuid + '/' + slug : base + '/p/' + p.uuid;
        const lastmod = p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] : '';
        xml += '  <url>\n';
        xml += '    <loc>' + loc + '</loc>\n';
        if (lastmod) xml += '    <lastmod>' + lastmod + '</lastmod>\n';
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += '    <priority>0.7</priority>\n';
        xml += '  </url>\n';
      }
    }

    xml += '</urlset>';
    res.type('application/xml');
    res.send(xml);
  } catch (err) {
    logger.error('Sitemap error:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.ico'));
});
app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.png'));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 DescriviCasa running on http://0.0.0.0:${PORT}`);
  await initDatabase();
  cleanupOldFiles();
});

// ── Auto-cleanup: cancella foto ogni 30 min (più vecchie di 4 ore) ─
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const FILE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

async function cleanupOldFiles() {
  try {
    const files = await fs.promises.readdir(UPLOAD_DIR);
    const now = Date.now();
    let deleted = 0;
    for (const file of files) {
      const fp = path.join(UPLOAD_DIR, file);
      try {
        const stat = await fs.promises.stat(fp);
        if (now - stat.mtimeMs > FILE_MAX_AGE_MS) {
          await fs.promises.unlink(fp);
          deleted++;
        }
      } catch (_) { /* skip */ }
    }
    if (deleted > 0) logger.info(`🧹 Cleanup: ${deleted} file eliminati`);
  } catch (_) { /* directory doesn't exist */ }
}

setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);
