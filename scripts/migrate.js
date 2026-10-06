#!/usr/bin/env node
// Run with:  npm run db:migrate
// Creates/updates all database tables. Safe to run more than once.
const { getDb, closeDb } = require('../src/db');
const { migrate } = require('../src/db/migrate');

(async () => {
  try {
    const ran = await migrate(await getDb());
    console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database already up to date.');
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
})();
