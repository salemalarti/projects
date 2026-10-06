// App entry point.
//  - Locally:  npm start  (or  npm run dev)  starts a web server on PORT.
//  - On Vercel: Vercel detects this Express app automatically and uses the
//    exported `app` (it serves files in public/ from its CDN).
require('express'); // tells Vercel's zero-config detection this is an Express app
const config = require('./src/config');
const logger = require('./src/logger');
const { createApp } = require('./src/app');
const { getDb, closeDb } = require('./src/db');
const { migrate } = require('./src/db/migrate');

const app = createApp();

async function start() {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL is not set: pages will load but data and signups will not work. See SETUP.md.');
  } else if (process.env.AUTO_MIGRATE !== 'false') {
    try {
      const ran = await migrate(await getDb());
      if (ran.length) logger.info(`Applied migrations: ${ran.join(', ')}`);
    } catch (err) {
      logger.error(`Could not connect to the database: ${err.message}`);
    }
  }
  if (!config.email.enabled) {
    logger.warn('Email is not configured (EMAIL_PROVIDER/EMAIL_API_KEY/EMAIL_FROM). Signups will get their access link on screen instead.');
  }
  const server = app.listen(config.port, () => {
    logger.info(`Server running on http://localhost:${config.port}`);
    logger.info(`Landing page:  http://localhost:${config.port}/`);
    logger.info(`Dashboard:     http://localhost:${config.port}/dashboard`);
  });
  const shutdown = () => server.close(() => closeDb().finally(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();

module.exports = app;
