// Express application (shared by local server.js and the Vercel function).
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');
const gamesRouter = require('./routes/games');
const eventsRouter = require('./routes/events');
const { createBetaRouter } = require('./routes/beta');
const { notFound, errorHandler } = require('./middleware/errors');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp({ emailSender, baseUrl } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Vercel / reverse proxy sets X-Forwarded-For

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));

  // Same-origin requests need no CORS. Extra origins can be allowed via CORS_ORIGINS.
  const allowed = new Set([config.baseUrl, ...config.corsOrigins]);
  app.use('/api', cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));

  app.use(express.json({ limit: '20kb' }));

  // Request log (method, path, status, time). Query strings are not logged.
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`);
    });
    next();
  });

  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' } });
  const signupLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many signup attempts from this network. Please try again in an hour.' } });
  const eventLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many events' } });

  app.get('/api/health', async (req, res) => {
    try {
      const db = await getDb();
      await db.query('SELECT 1');
      res.json({ ok: true, database: 'connected', emailConfigured: config.email.enabled });
    } catch (err) {
      res.status(503).json({ ok: false, database: err.code === 'DB_NOT_CONFIGURED' ? 'not_configured' : 'unreachable' });
    }
  });

  app.use('/api/beta-signups', signupLimiter);
  app.use('/api/events', eventLimiter);
  app.use('/api', apiLimiter);
  app.use('/api', gamesRouter);
  app.use('/api', eventsRouter);
  app.use('/api', createBetaRouter({ emailSender, baseUrl }));
  app.use('/api', notFound);

  // Pages (on Vercel these are served by vercel.json rewrites + the CDN).
  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'landing.html')));
  app.get('/dashboard', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: config.isProduction ? '1h' : 0 }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
