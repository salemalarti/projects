// Database access. Production uses PostgreSQL (Supabase) through `pg` with
// parameterized queries only. `DATABASE_URL=pglite:<folder>` runs an embedded
// Postgres for local experiments and tests (requires the dev dependency).
const config = require('../config');

let db = null;

function toInt(v) {
  // pg returns BIGINT as strings; all our counts fit safely in a JS number.
  return v === null || v === undefined ? null : Number(v);
}

async function createPgDatabase(url) {
  const { Pool } = require('pg');
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX || 3), // small: serverless-friendly
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: isLocal || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => require('../logger').error('Postgres pool error', { message: err.message }));
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    exec: (text) => pool.query(text),
    close: () => pool.end(),
  };
}

async function createPgliteDatabase(dir) {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    throw new Error('DATABASE_URL uses pglite: but @electric-sql/pglite is not installed. Run "npm install" (dev dependencies).');
  }
  const pg = new PGlite(dir || undefined);
  await pg.waitReady;
  return {
    kind: 'pglite',
    query: (text, params) => pg.query(text, params),
    exec: (text) => pg.exec(text),
    close: () => pg.close(),
  };
}

async function connect(url = config.databaseUrl) {
  if (!url) {
    const err = new Error('DATABASE_URL is not set. See SETUP.md, step "Connect Supabase".');
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (url.startsWith('pglite:')) return createPgliteDatabase(url.slice('pglite:'.length));
  return createPgDatabase(url);
}

async function getDb() {
  if (!db) db = connect();
  try {
    return await db;
  } catch (err) {
    db = null; // allow a later retry
    throw err;
  }
}

// Used by tests to inject a database.
function setDb(instance) {
  db = instance ? Promise.resolve(instance) : null;
}

async function closeDb() {
  if (!db) return;
  const instance = await db.catch(() => null);
  db = null;
  if (instance) await instance.close();
}

module.exports = { getDb, setDb, closeDb, connect, toInt };
