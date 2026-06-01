const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 8000;

// ── Config ────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer storage
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
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Static files ──────────────────────────────────────────────────
app.use('/media/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ── AI Vision Call ────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'google/gemini-2.5-flash-image';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const SYSTEM_PROMPT = `Sei un copywriter esperto nel settore immobiliare italiano.
Il tuo compito è analizzare le foto di un immobile e scrivere una descrizione
professionale in italiano per un annuncio di vendita.

REGOLE:
- Scrivi in italiano, tono caldo e professionale
- Massimo 3 paragrafi
- Includi dettagli reali che vedi nelle foto
- Non inventare stanze o caratteristiche che non vedi
- Sii onesto ma appassionante
- Adatto a siti come Idealista, Immobiliare.it, Casa.it`;

const USER_PROMPT = `Descrivi questo immobile per un annuncio di vendita.
Dimmi anche: tipo di immobile (appartamento, villa, ufficio...),
numero stanze/van, stile (moderno, classico, rustico...),
piano, presenza di balconi/giardino, stato di manutenzione,
e qualsiasi altro dettaglio rilevante che vedi nelle foto.`;

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
    const mime = getMime(ext);
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${b64}` },
    });
  }

  const payload = {
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content },
    ],
    max_tokens: 1024,
    temperature: 0.7,
  };

  const headers = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://descrivicasa.it',
    'X-Title': 'DescriviCasa',
  };

  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { error: `API error ${resp.status}: ${text}` };
  }

  const data = await resp.json();

  try {
    const description = data.choices[0].message.content;
    return {
      description,
      model: data.model || VISION_MODEL,
      tokens: data.usage || {},
    };
  } catch (e) {
    return { error: 'Unexpected API response', raw: data };
  }
}

// ── Routes ────────────────────────────────────────────────────────

// All static pages served via /public/index.html etc.

app.post('/analyze', upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto' });
    }

    const savedPaths = req.files.map((f) => f.path);

    const result = await describeProperty(savedPaths);

    if (result.error) {
      return res.status(500).json(result);
    }

    const imageUrls = req.files.map(
      (f) => `/media/uploads/${path.basename(f.path)}`
    );

    res.json({
      description: result.description,
      images: imageUrls,
      model: result.model || '',
    });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message || 'Errore interno' });
  }
});

// Fallback: serve index.html for SPA-style routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DescriviCasa running on http://0.0.0.0:${PORT}`);
});
