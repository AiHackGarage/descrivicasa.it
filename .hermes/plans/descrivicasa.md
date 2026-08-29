# Piano Progetto: DescriviCasa.it

**Ultimo aggiornamento:** 2026-08-29
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
- Chat assistente: widget self-contained (`public/js/chat.js` crea CSS+DOM da solo), presente in TUTTE le 5 pagine (index, pricing, property, privacy, termini), funziona anche non loggati. Rimosse copie vecchie (markup in index.html, CSS in pricing.html)
- Fix sitemap 500: `updated_at` stringa (dateStrings:true) crashava `.toISOString()` in `pages.js` — ora gestisce stringa/Date/null. Sitemap 200, XML valido, include pagine immobili pubbliche (max 1000)
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
- **REFACTOR TOPBAR → COMPONENTE UNICO (DRY)** (29/08/2026): la topbar è duplicata in 5 HTML + CSS in main.css/property.css/inline. Convertire `topbar.js` in componente self-contained (markup+CSS iniettati, come chat.js), gestendo SPA (navigateTo) vs pagine statiche (href). Rimuovere tutte le copie. Verificare media query mobile (su mobile la home nasconde .topbar-links, le altre no).
- **ISTRUIRE MEGLIO L'ASSISTENTE CHAT** (richiesto da Riccardo, 29/08/2026 — da fare): oggi `CHAT_SYSTEM` in `src/services/ai/prompts.js` ha una knowledge base minima (~15 righe) → il modello si inventa risposte. Interventi concordati: 1) riscrivere CHAT_SYSTEM con knowledge base completa e accurata (piani/prezzi/limiti reali, foto per piano, PDF, registrazione, pagamento, modifica immobili, FAQ vere); 2) regola anti-allucinazione ("rispondi SOLO con info del prompt, altrimenti → info@descrivicasa.it"); 3) abbassare temperature da 0.7 a ~0.3 in `src/routes/analyze.js:109`. ⚠️ Verificare con Riccardo se il piano Pro ha davvero un'API (il prompt attuale dice "API" ma PLAN_CONFIG non la prevede — probabile info falsa da togliere). Chiedere a Riccardo quali domande ha fatto al bot per coprirle nella knowledge base.
