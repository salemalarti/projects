#!/usr/bin/env node
// Run with:  npm run scrape
// Collects real Roblox data and stores today's snapshot. Safe to run repeatedly.
const { getDb, closeDb } = require('../src/db');
const { migrate } = require('../src/db/migrate');
const { runScrape } = require('../src/roblox/scraper');
const logger = require('../src/logger');

(async () => {
  let code = 0;
  try {
    const db = await getDb();
    await migrate(db); // no-op if the schema is already up to date
    const summary = await runScrape({ db });
    if (summary.status === 'failed') code = 1;
  } catch (err) {
    logger.error(`Scrape could not run: ${err.message}`);
    code = 1;
  } finally {
    await closeDb();
  }
  process.exit(code);
})();
