const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

function errorHandler(err, req, res, _next) {
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
}

module.exports = { errorHandler };
