const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
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
  console.error('❌ JWT_SECRET non impostato nelle variabili d\'ambiente. Il server non può avviarsi.');
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
    const session = uuidv4().slice(0, 12);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${session}_${uuidv4().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
  },
});

// ── Middleware ─────────────────────────────────────────────────────
app.use(express.json());
app.use('/media/uploads', express.static(UPLOAD_DIR));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
    console.log('✅ Database tables ready');

    // Run migrations: add agent columns if missing
    try {
      const migrationConn = await pool.getConnection();
      const [cols] = await migrationConn.query("SHOW COLUMNS FROM properties LIKE 'agent_%'");
      if (cols.length === 0) {
        await migrationConn.query("ALTER TABLE properties ADD COLUMN agent_name VARCHAR(200) DEFAULT NULL AFTER condo_fees");
        await migrationConn.query("ALTER TABLE properties ADD COLUMN agent_phone VARCHAR(50) DEFAULT NULL AFTER agent_name");
        await migrationConn.query("ALTER TABLE properties ADD COLUMN agent_email VARCHAR(255) DEFAULT NULL AFTER agent_phone");
        console.log('✅ Migration: agent columns added');
      }
      migrationConn.release();
    } catch (migErr) {
      console.error('⚠️  Migration warning:', migErr.message);
    }
  } catch (err) {
    console.error('❌ Database init error:', err.message);
    console.log('⚠️  Server will continue without database');
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
async function callVisionAPI(imagePaths, systemContent, userText) {
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
      max_tokens: 2048,
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

async function describeProperty(imagePaths, lang = 'it') {
  const systemContent = lang === 'it' ? SYSTEM_PROMPT : SYSTEM_PROMPT.replace(/italiano/g, 'English').replace(/italiane/g, 'Italian');
  const userText = lang === 'it' ? USER_PROMPT : USER_PROMPT.replace(/italiano/g, 'English');
  return callVisionAPI(imagePaths, systemContent, userText);
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
    console.error('Register error:', err);
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
    console.error('Login error:', err);
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
    console.error('Google auth error:', err);
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
    const [users] = await pool.query('SELECT id, name, email, avatar, plan, monthly_generations, monthly_reset, created_at FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });
    const user = users[0];
    const limit = PLAN_LIMITS[user.plan || 'free'];
    const remaining = Math.max(0, limit - (user.monthly_generations || 0));
    // Reset se cambio mese
    const today = new Date().toISOString().slice(0, 10);
    const genRemaining = user.monthly_reset !== today ? limit : remaining;
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

async function checkGenerationLimit(userId, plan) {
  const [rows] = await pool.query(
    'SELECT monthly_generations, monthly_reset FROM users WHERE id = ?',
    [userId]
  );
  if (rows.length === 0) return { allowed: false, remaining: 0 };

  const { monthly_generations, monthly_reset } = rows[0];
  const today = new Date().toISOString().slice(0, 10);
  const limit = PLAN_LIMITS[plan] || 3;

  // Reset mensile
  if (monthly_reset !== today) {
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
app.post('/analyze', aiLimiter, authMiddleware, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto' });
    }

    // Check limit
    const limitCheck = await checkGenerationLimit(req.user.id, req.user.plan || 'free');
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Hai raggiunto il limite di ${PLAN_LIMITS[req.user.plan || 'free']} descrizioni gratuite. Passa a un piano a pagamento per continuare.`,
        remaining: 0,
      });
    }

    const result = await describeProperty(req.files.map((f) => f.path));
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
    ).catch(err => console.error('Save history error:', err.message));

    res.json({
      description: finalDescription,
      title: extractTitle(finalDescription, null),
      images: imageUrls,
      model: result.model || '',
      remaining: limitCheck.remaining - 1,
    });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message || 'Errore interno' });
  }
});

// ── Chatbot ───────────────────────────────────────────────────────
const CHAT_MODEL = process.env.CHAT_MODEL || 'deepseek/deepseek-chat';

const CHAT_SYSTEM = `Sei un assistente virtuale di DescriviCasa.it, un servizio che genera descrizioni immobiliari professionali tramite AI.

Il servizio funziona così:
- L'utente carica fino a 5 foto di un immobile
- L'AI analizza le foto e genera una descrizione professionale in italiano
- Le descrizioni sono adatte per Idealista, Immobiliare.it, Casa.it

PREZZI:
- Free: 3 descrizioni gratis al mese
- Base: €9/mese, 50 descrizioni, 5 foto per descrizione
- Pro: €29/mese, illimitate, 10 foto per descrizione, PDF, API, supporto prioritario

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
    console.error('Chat error:', err);
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

async function describePropertyWithData(imagePaths, propertyData) {
  return callVisionAPI(imagePaths, SYSTEM_PROMPT, buildPropertyPrompt(propertyData));
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
    const uuid = uuidv4();
    const photoUrls = req.files ? req.files.map(f => `/media/uploads/${path.basename(f.path)}`) : [];

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
    console.error('Create property error:', err);
    res.status(500).json({ error: err.message || 'Errore creazione immobile' });
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
    res.status(500).json({ error: err.message });
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
    p.photos = p.photos ? JSON.parse(p.photos) : [];
    p.elevator = !!p.elevator;
    p.air_conditioning = !!p.air_conditioning;
    p.parking = !!p.parking;
    p.basement = !!p.basement;
    p.is_public = !!p.is_public;
    res.json({ property: p });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    try { existingPhotos = existing[0][0].photos ? JSON.parse(existing[0][0].photos) : []; } catch (_) {}

    if (req.files && req.files.length > 0) {
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
      existingPhotos.length > 0 ? JSON.stringify(existingPhotos) : null,
      data.status || 'draft', data.title || null, data.description || null,
      req.params.id, req.user.id,
    ]);

    res.json({ message: 'Immobile aggiornato' });
  } catch (err) {
    console.error('Update property error:', err);
    res.status(500).json({ error: err.message || 'Errore aggiornamento' });
  }
});

// Delete property
app.delete('/api/properties/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Immobile eliminato' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate description for a property (with photos + data)
app.post('/api/properties/:id/generate', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    const property = rows[0];
    let photos = property.photos ? JSON.parse(property.photos) : [];

    // If new files uploaded, add them
    if (req.files && req.files.length > 0) {
      const newPhotos = req.files.map(f => `/media/uploads/${path.basename(f.path)}`);
      photos = [...photos, ...newPhotos];
    }

    if (photos.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto per generare la descrizione' });
    }

    // Check generation limit
    const limitCheck = await checkGenerationLimit(req.user.id, req.user.plan || 'free');
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Hai raggiunto il limite di ${PLAN_LIMITS[req.user.plan || 'free']} descrizioni gratuite.`,
        remaining: 0,
      });
    }

    // Convert photo URLs to local file paths (use UPLOAD_DIR, not __dirname/uploads)
    const filePaths = photos.map(url => path.join(UPLOAD_DIR, path.basename(url))).filter(fs.existsSync);

    // Load contact info from property, fall back to user profile
    const propertyWithContacts = {
      ...property,
      agent_name: property.agent_name || req.user.name,
      agent_phone: property.agent_phone || null,
      agent_email: property.agent_email || req.user.email,
    };

    const result = await describePropertyWithData(filePaths, propertyWithContacts);
    if (result.error) return res.status(500).json(result);

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
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Errore generazione' });
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
    p.photos = p.photos ? JSON.parse(p.photos) : [];
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
    res.status(500).json({ error: err.message });
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
app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'robots.txt'));
});
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.ico'));
});
app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.png'));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 DescriviCasa running on http://0.0.0.0:${PORT}`);
  await initDatabase();
  cleanupOldFiles();
});

// ── Auto-cleanup: cancella foto ogni 30 min (più vecchie di 4 ore) ─
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const FILE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function cleanupOldFiles() {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    let deleted = 0;
    for (const file of files) {
      const fp = path.join(UPLOAD_DIR, file);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > FILE_MAX_AGE_MS) {
          fs.unlinkSync(fp);
          deleted++;
        }
      } catch (_) { /* skip */ }
    }
    if (deleted > 0) console.log(`🧹 Cleanup: ${deleted} file eliminati`);
  });
}

setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);
