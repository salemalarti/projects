const logger = require('../logger');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Wraps async route handlers so thrown errors reach the error handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err.code === 'DB_NOT_CONFIGURED') {
    logger.error('Database not configured');
    return res.status(503).json({ error: 'Service is not configured yet (database missing).' });
  }
  // Unexpected: log details server-side, return a generic message (no secrets/stack traces).
  logger.error('Unhandled error', { path: req.path, message: err.message });
  return res.status(500).json({ error: 'Something went wrong. Please try again later.' });
}

module.exports = { HttpError, asyncHandler, notFound, errorHandler };
