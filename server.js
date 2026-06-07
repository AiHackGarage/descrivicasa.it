const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 8000;

// ── Config ────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Database ──────────────────────────────────────────────────────
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'u116036854_hermes',
  password: process.env.DB_PASS || "/6|3J>>*bAAb",
  database: process.env.DB_NAME || 'u116036854_descrivicasadb',
  waitForConnections: true,
  connectionLimit: 10,
};

const pool = mysql.createPool(DB_CONFIG);

// ── JWT ────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || uuidv4() + uuidv4();
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    conn.release();
    console.log('✅ Database tables ready');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
    console.log('⚠️  Server will continue without database');
  }
}

// ── AI Vision Call ────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'google/gemini-2.5-flash-image';
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

📞 CONTATTI (sempre questa frase esatta):
Per maggiori informazioni o per fissare una visita, contatta l'agenzia.

REGOLE DI STILE:
- Tono caldo, professionale, mai troppo tecnico
- Usa aggettivi evocativi ma onesti
- DAI PRIORITÀ a ciò che vedi realmente nelle foto
- Non inventare stanze, piani, metrature o caratteristiche non visibili
- Se non vedi una caratteristica, omettila invece di inventarla
- Non superare le 400 parole in totale
- Cattura l'emozione di vivere in quella casa`;

const USER_PROMPT = `Analizza attentamente queste foto e scrivi una descrizione professionale completa pronta per essere pubblicata su Idealista, seguendo la struttura obbligatoria: TITOLO, DESCRIZIONE in paragrafi, ZONA, CARATTERISTICHE CHIAVE in elenco puntato, CONTATTI. Non aggiungere preamboli o frasi di cortesia. Produci solo la descrizione dell'annuncio.`;

function encodeImage(filepath) {
  return fs.readFileSync(filepath, { encoding: 'base64' });
}

function getMime(ext) {
  const mimeMap = { png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return mimeMap[ext] || 'image/jpeg';
}

async function describeProperty(imagePaths, lang = 'it') {
  const content = [];
  const systemContent = lang === 'it' ? SYSTEM_PROMPT : SYSTEM_PROMPT.replace(/italiano/g, 'English').replace(/italiane/g, 'Italian');
  const userText = lang === 'it' ? USER_PROMPT : USER_PROMPT.replace(/italiano/g, 'English');
  content.push({ type: 'text', text: userText });

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

// ── Auth Routes ───────────────────────────────────────────────────

// Registrazione con email
app.post('/api/register', async (req, res) => {
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
app.post('/api/login', async (req, res) => {
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
app.post('/api/auth/google', async (req, res) => {
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
      'SELECT id, description, image_urls, model, created_at FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
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
app.post('/analyze', authMiddleware, upload.array('files', 5), async (req, res) => {
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

    // Save to history
    const imageUrls = req.files.map((f) => `/media/uploads/${path.basename(f.path)}`);
    await pool.query(
      'INSERT INTO generations (user_id, description, image_urls, model) VALUES (?, ?, ?, ?)',
      [req.user.id, result.description, JSON.stringify(imageUrls), result.model || '']
    ).catch(err => console.error('Save history error:', err.message));

    res.json({
      description: result.description,
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

app.post('/api/chat', async (req, res) => {
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
