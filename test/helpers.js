// Test helpers. Uses a real local PostgreSQL (TEST_DATABASE_URL) when available,
// otherwise an in-memory embedded Postgres (PGlite). Never point this at production:
// it wipes the database schema.
process.env.NODE_ENV = 'test';
const http = require('http');
const { connect } = require('../src/db');
const { migrate } = require('../src/db/migrate');

const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ra_test';

async function freshDb() {
  let db;
  try {
    db = await connect(TEST_URL);
    await db.query('SELECT 1');
  } catch {
    if (db) await db.close().catch(() => {});
    db = await connect('pglite:'); // in-memory fallback
  }
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}

// Local fake of the Roblox endpoints. `routes` maps pathname -> handler(url) returning
// { status, body, headers } or a plain object (200 JSON).
function startMockServer(routes) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    calls.push(url.pathname + url.search);
    const handler = routes[url.pathname];
    if (!handler) { res.writeHead(404); return res.end('{}'); }
    let out = handler(url, calls);
    if (!out || out.status === undefined) out = { status: 200, body: out };
    res.writeHead(out.status, { 'Content-Type': 'application/json', ...(out.headers || {}) });
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) });
  }));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({
      base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

module.exports = { freshDb, startMockServer, listen };
