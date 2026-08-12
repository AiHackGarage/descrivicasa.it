const express = require('express');
const path = require('path');

const { PORT, UPLOAD_DIR } = require('./config');
const { initDatabase } = require('./db/schema');
const { securityHeaders, csrfProtection } = require('./middleware/security');
const { errorHandler } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimit');

const stripeRouter = require('./routes/stripe');
const authRouter = require('./routes/auth');
const propertiesRouter = require('./routes/properties');
const analyzeRouter = require('./routes/analyze');
const publicRouter = require('./routes/public');
const pagesRouter = require('./routes/pages');

const app = express();
app.set('trust proxy', 1);

// Stripe webhook — needs raw body, must be before express.json()
const { handleWebhook } = require('./services/stripe');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Rest of Stripe routes (need JSON body)
app.use(express.json());
app.use('/api/stripe', stripeRouter);
app.use('/media/uploads', express.static(UPLOAD_DIR));

// Serve JS with no-cache to prevent stale ES module imports after deploy
app.use('/js', (req, res, next) => {
  res.set('Cache-Control', 'no-cache');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(securityHeaders);
app.use(csrfProtection);
app.use('/api', generalLimiter);

app.use('/api', authRouter);
app.use('/api/properties', propertiesRouter);
app.use('/', analyzeRouter);
app.use('/api', publicRouter);
app.use('/', pagesRouter);

app.use(errorHandler);

module.exports = { app, initDatabase };
