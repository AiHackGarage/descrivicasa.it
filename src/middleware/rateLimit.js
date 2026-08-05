const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
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
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste AI. Riprova tra un minuto.' },
});

module.exports = { generalLimiter, authLimiter, aiLimiter };
