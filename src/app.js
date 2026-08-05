const express = require('express');
const path = require('path');

const { PORT, UPLOAD_DIR } = require('./config');
const { initDatabase } = require('./db/schema');
const { securityHeaders } = require('./middleware/security');
const { errorHandler } = require('./middleware/errorHandler');

const stripeRouter = require('./routes/stripe');
const authRouter = require('./routes/auth');
const propertiesRouter = require('./routes/properties');
const analyzeRouter = require('./routes/analyze');
const publicRouter = require('./routes/public');
const pagesRouter = require('./routes/pages');

const app = express();
app.set('trust proxy', 1);

// Stripe webhook MUST be registered before express.json() — it has its own raw body parser
app.use('/api/stripe', stripeRouter);

app.use(express.json());
app.use('/media/uploads', express.static(UPLOAD_DIR));
app.use(securityHeaders);

app.use('/api', authRouter);
app.use('/api/properties', propertiesRouter);
app.use('/', analyzeRouter);
app.use('/api', publicRouter);
app.use('/', pagesRouter);

app.use(errorHandler);

module.exports = { app, initDatabase };
