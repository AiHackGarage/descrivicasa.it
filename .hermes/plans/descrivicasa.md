# Piano Progetto: DescriviCasa.it

**Ultimo aggiornamento:** 2026-08-12
**Stato:** Attivo, miglioramenti continui
**Deploy:** Hostinger Business (Node.js, GitHub auto-deploy)

## Tecnologia
- **Backend:** Node.js / Express, porta 8000
- **Frontend:** HTML/CSS/JS vanilla, SPA con view system
- **Database:** MySQL su Hostinger Business (host: 127.0.0.1, NON localhost!)
- **PDF:** PDFKit 0.15
- **AI Vision:** google/gemini-2.5-flash-image via OpenRouter
- **Payment:** Stripe (piani Free/Pro)
- **Auth:** JWT 30gg + Google OAuth

## Struttura progetto
```
descrivicasa.it/
├── server.js              # Entry point
├── src/
│   ├── app.js             # Express app
│   ├── config/index.js    # Config
│   ├── db/                # MySQL pool + schema
│   ├── middleware/        # auth, security, rateLimit, errorHandler
│   ├── routes/            # auth, properties, public, pages, stripe, analyze
│   ├── services/
│   │   ├── ai/            # prompts.js + vision.js
│   │   ├── pdf.js         # Generazione PDF
│   │   ├── image.js       # Resize foto per PDF
│   │   └── stripe.js
│   └── utils/             # text.js, schemas.js, validate.js, errors.js, limits.js
├── public/
│   ├── index.html         # SPA principale
│   ├── property.html      # Pagina immobile pubblica
│   ├── pricing.html       # Pagina prezzi
│   ├── css/               # main.css, property.css
│   └── js/                # auth, dashboard, editor, detail, edit, chat, profile, etc.
└── tests/                 # Jest
```

## Ultime modifiche (agosto 2026)
- Migliorata impaginazione PDF pagina 2 (spazio titolo-descrizione, box Caratteristiche con sfondo lightBg)
- Separatori box Caratteristiche PDF resi invisibili (colore = sfondo #f5f5f7)
- Aggiunta sezione dati reali nel PDF invece di prompt AI
- Rimosso cleanup automatico foto (le foto restano per sempre)
- Fix avatar default per utenti senza Google

## Regole
- **REGOLA #1:** Mai agire in autonomia. Spiegare piano e chiedere permesso prima di codice/git/deploy/test.
- Comunicare in italiano
- Deploy via GitHub push → Hostinger auto-deploy (Entry=server.js, Framework=Other)
- ⚠️ UPLOAD_DIR=/home/u116036854/descrivicasa_uploads su hPanel (altrimenti foto cancellate a ogni deploy)
- DB: usare 127.0.0.1 come host, MAI localhost
- Foto: MAI cancellare automaticamente

## TODO / Idee future
- (da definire)
