// Standardized error handling for route handlers
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Log an error and send a standardized 500 response.
 * Always logs the real error server-side but never exposes it to the client.
 *
 * @param {Error} err - The caught error
 * @param {Response} res - Express response object
 * @param {string} context - Human-readable context (e.g., 'Create property')
 * @param {Object} [extra] - Additional structured fields for the log (e.g., { userId, propertyId })
 */
function serverError(err, res, context, extra = {}) {
  logger.error({ err: { message: err.message, stack: err.stack?.slice(0, 500), code: err.code, name: err.name }, ...extra }, context);
  res.status(500).json({ error: 'Errore interno del server' });
}

/**
 * Send a standardized 400 validation error (no logging needed).
 */
function validationError(res, message) {
  return res.status(400).json({ error: message });
}

/**
 * Send a standardized 404 not found error (no logging needed).
 */
function notFound(res, message = 'Risorsa non trovata') {
  return res.status(404).json({ error: message });
}

/**
 * Send a standardized 403 forbidden error (no logging needed).
 */
function forbidden(res, message) {
  return res.status(403).json({ error: message });
}

/**
 * Sanitize an AI service error response — never pass raw service errors to the client.
 * Logs the real error, returns a generic message.
 *
 * @param {Object} result - The result object from an AI service call (may have .error)
 * @param {Response} res - Express response object
 * @param {string} context - Context for the log (e.g., 'analyze', 'generate')
 */
function aiError(result, res, context) {
  logger.error({ aiError: result.error, details: result.details || result.message || '' }, `AI ${context} error`);
  return res.status(502).json({ error: `Errore del servizio di generazione. Riprova più tardi.` });
}

module.exports = { serverError, validationError, notFound, forbidden, aiError };
