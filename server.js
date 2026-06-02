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
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

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

// ── Static files ──────────────────────────────────────────────────
app.use('/media/uploads', express.static(UPLOAD_DIR));

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
      max_tokens: 1024,
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

// ── API Routes ────────────────────────────────────────────────────

app.post('/analyze', upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto' });
    }
    const result = await describeProperty(req.files.map((f) => f.path));
    // Cleanup: cancella le foto dopo averle processate
    for (const f of req.files) {
      fs.unlink(f.path, (err) => {
        if (err) console.error('Cleanup error:', err.message);
      });
    }
    if (result.error) return res.status(500).json(result);
    res.json({
      description: result.description,
      images: req.files.map((f) => `/media/uploads/${path.basename(f.path)}`),
      model: result.model || '',
    });
  } catch (err) {
    console.error('Analyze error:', err);
    // Cleanup anche in caso di errore
    if (req.files) {
      for (const f of req.files) {
        fs.unlink(f.path, (e) => {
          if (e) console.error('Cleanup error:', e.message);
        });
      }
    }
    res.status(500).json({ error: err.message || 'Errore interno' });
  }
});

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DescriviCasa running on http://0.0.0.0:${PORT}`);
});
