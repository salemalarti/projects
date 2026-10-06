#!/usr/bin/env node
// Run with:  npm run check-env
// Checks your .env settings and tests the database connection, in plain English.
const config = require('../src/config');
const { getDb, closeDb } = require('../src/db');

const ok = (m) => console.log(`  ✅ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };

(async () => {
  console.log('\nChecking your settings...\n');
  if (!config.databaseUrl) bad('DATABASE_URL is empty. Follow SETUP.md step 3.');
  else if (config.databaseUrl.includes('[YOUR-PASSWORD]')) bad('DATABASE_URL still contains [YOUR-PASSWORD]. Replace it with your real database password.');
  else {
    try {
      const db = await getDb();
      await db.query('SELECT 1');
      ok('Database connection works.');
      const { rows } = await db.query("SELECT to_regclass('public.games') AS t");
      if (rows[0].t) ok('Database tables exist.');
      else warn('Tables not created yet. Run: npm run db:migrate');
    } catch (err) {
      bad(`Could not connect to the database: ${err.message}`);
    }
  }
  if (config.email.enabled) ok(`Email is on (Resend), sending from ${config.email.from}.`);
  else if (config.email.provider === 'resend') bad('EMAIL_PROVIDER=resend but EMAIL_API_KEY or EMAIL_FROM is empty.');
  else warn('Email is off. Signups still work; people see their access link on screen.');
  if (config.isProduction && config.baseUrl.startsWith('http://localhost')) bad('BASE_URL is still localhost in production. Set it to your real site address.');
  else ok(`BASE_URL is ${config.baseUrl}`);
  await closeDb();
  console.log(process.exitCode ? '\nFix the ❌ items above, then run this again.\n' : '\nAll good!\n');
})();
