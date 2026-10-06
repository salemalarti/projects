const test = require('node:test');
const assert = require('node:assert');
const { freshDb, listen, startMockServer } = require('./helpers');
const { setDb } = require('../src/db');
const { createApp } = require('../src/app');
const { runScrape } = require('../src/roblox/scraper');
const { createHttpClient } = require('../src/roblox/httpClient');
const { createEmailSender } = require('../src/email/provider');
const { sortContent, gameDetails } = require('./fixtures/roblox');

const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

// Email sender that records messages instead of sending them.
function recordingSender() {
  const sent = [];
  return { enabled: true, sent, async send(m) { sent.push(m); return { sent: true, id: 'test' }; } };
}

test('HTTP API', async (t) => {
  const db = await freshDb();
  setDb(db);
  // Seed via the real pipeline against a mock Roblox.
  const mock = await startMockServer({
    '/explore-api/v1/get-sort-content': (url) => sortContent(url.searchParams.get('sortId'), [11, 12, 13]),
    '/v1/games': (url) => ({ data: url.searchParams.get('universeIds').split(',').map(Number).map((id) => gameDetails(id)) }),
    '/v1/games/votes': () => ({ data: [] }),
  });
  await runScrape({
    db,
    robloxConfig: { sortIds: ['top-playing-now'], extraUniverseIds: [], maxGames: 50, gamesApiBase: mock.base, exploreApiBase: mock.base },
    http: createHttpClient({ requestDelayMs: 0 }),
    log: quietLog,
  });
  await mock.close();

  const sender = recordingSender();
  const server = await listen(createApp({ emailSender: sender, baseUrl: 'http://app.test' }));
  const noEmailServer = await listen(createApp({ emailSender: createEmailSender({ provider: 'none' }), baseUrl: 'http://app.test' }));
  t.after(async () => { await server.close(); await noEmailServer.close(); setDb(null); await db.close(); });

  const get = (p, opts) => fetch(server.base + p, { redirect: 'manual', ...opts });
  const post = (p, body, base = server.base) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  await t.test('GET /api/health', async () => {
    const r = await get('/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).database, 'connected');
  });

  await t.test('GET /api/games returns stored games with freshness', async () => {
    const r = await get('/api/games');
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.data.length, 3);
    assert.strictEqual(body.data[0].universeId, 13, 'sorted by players');
    assert.ok(body.meta.dataUpdatedAt);
    assert.strictEqual(body.data[0].retentionRate, null);
    assert.strictEqual(body.data[0].avgSessionLength, null);
    assert.strictEqual(body.data[0].trend, 'insufficient_data');
    assert.strictEqual(body.data[0].robloxUrl, 'https://www.roblox.com/games/130');
  });

  await t.test('GET /api/games filters + validation', async () => {
    const r = await (await get('/api/games?genre=Action&sort=visits')).json();
    assert.ok(r.data.every((g) => g.genre === 'Action'));
    assert.strictEqual((await get('/api/games?sort=bogus')).status, 400);
    assert.strictEqual((await get('/api/games?limit=0')).status, 400);
    assert.strictEqual((await get('/api/games?limit=abc')).status, 400);
    assert.strictEqual((await get('/api/games?trend=sideways')).status, 400);
  });

  await t.test('GET /api/games/:id', async () => {
    assert.strictEqual((await (await get('/api/games/12')).json()).data.name, 'Test Game 12');
    assert.strictEqual((await get('/api/games/999')).status, 404);
    assert.strictEqual((await get('/api/games/abc')).status, 400);
    assert.strictEqual((await get("/api/games/1;DROP TABLE games")).status, 400);
  });

  await t.test('GET /api/trends and /api/genres', async () => {
    const tr = await (await get('/api/trends')).json();
    assert.strictEqual(tr.data.counts.insufficient_data, 3);
    assert.strictEqual(tr.meta.thresholdPct, 10);
    const ge = await (await get('/api/genres')).json();
    assert.ok(ge.data.find((g) => g.genre === 'Action'));
  });

  await t.test('history requires beta access', async () => {
    assert.strictEqual((await get('/api/games/12/history')).status, 401);
    assert.strictEqual((await get('/api/games/12/history', { headers: { Authorization: 'Bearer nope' } })).status, 401);
  });

  let accessToken;
  await t.test('signup -> confirmation email -> confirm -> beta access', async () => {
    const r = await post('/api/beta-signups', { name: 'Ada', email: 'Ada@Example.com', interest: 'genres' });
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.emailSent, true);
    assert.strictEqual(body.accessUrl, undefined, 'link only by email when email works');
    const row = (await db.query(`SELECT * FROM beta_signups WHERE email = 'ada@example.com'`)).rows[0];
    assert.ok(row);
    assert.strictEqual(row.email_confirmed, false);
    assert.match(row.access_token_hash, /^[0-9a-f]{64}$/, 'only hashes stored');

    const mail = sender.sent[0];
    const link = mail.text.match(/http:\/\/app\.test(\/api\/beta\/confirm\?token=[\w-]+)/)[1];
    assert.ok(!mail.text.includes(row.confirmation_token_hash));
    const confirm = await get(link);
    assert.strictEqual(confirm.status, 302);
    const loc = confirm.headers.get('location');
    assert.match(loc, /^\/dashboard#access=[\w-]{43}&confirmed=1$/);
    accessToken = loc.match(/access=([\w-]+)/)[1];
    const after = (await db.query(`SELECT * FROM beta_signups WHERE id = $1`, [row.id])).rows[0];
    assert.strictEqual(after.email_confirmed, true);
    assert.strictEqual(after.status, 'confirmed');

    // Link is single-use.
    const again = await get(link);
    assert.match(again.headers.get('location'), /error=expired_link/);

    const access = await get('/api/beta/access', { headers: { Authorization: `Bearer ${accessToken}` } });
    assert.strictEqual(access.status, 200);
    assert.strictEqual((await access.json()).name, 'Ada');
    const hist = await get('/api/games/12/history', { headers: { Authorization: `Bearer ${accessToken}` } });
    assert.strictEqual(hist.status, 200);
    assert.strictEqual((await hist.json()).data.length, 1);
  });

  await t.test('duplicate signup does not create a second row', async () => {
    const r = await post('/api/beta-signups', { name: 'Ada Again', email: 'ADA@example.com' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).status, 'already_registered');
    assert.strictEqual(Number((await db.query(`SELECT count(*) AS n FROM beta_signups`)).rows[0].n), 1);
    assert.strictEqual(sender.sent.length, 1, 'no re-send within the 10 minute cooldown');
  });

  await t.test('invalid signups are rejected', async () => {
    let r = await post('/api/beta-signups', { name: '', email: 'not-an-email' });
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.ok(body.details.name && body.details.email);
    r = await fetch(server.base + '/api/beta-signups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
    assert.strictEqual(r.status, 400);
    r = await post('/api/beta-signups', { name: 'x', email: 'a@b.co', interest: 'y'.repeat(5000) });
    assert.strictEqual(r.status, 400);
  });

  await t.test('honeypot submissions are not stored', async () => {
    const r = await post('/api/beta-signups', { name: 'Bot', email: 'bot@spam.test', website: 'http://spam' }, noEmailServer.base);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(Number((await db.query(`SELECT count(*) AS n FROM beta_signups WHERE email = 'bot@spam.test'`)).rows[0].n), 0);
  });

  await t.test('without email configured, the access link is returned honestly', async () => {
    const r = await post('/api/beta-signups', { name: 'Bo', email: 'bo@example.com' }, noEmailServer.base);
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.emailSent, false);
    assert.match(body.accessUrl, /^http:\/\/app\.test\/dashboard#access=[\w-]{43}$/);
    const token = body.accessUrl.split('access=')[1];
    const access = await fetch(server.base + '/api/beta/access', { headers: { Authorization: `Bearer ${token}` } });
    const a = await access.json();
    assert.strictEqual(a.valid, true);
    assert.strictEqual(a.emailConfirmed, false);
  });

  await t.test('signup endpoint is rate limited', async () => {
    let last;
    for (let i = 0; i < 6; i += 1) last = await post('/api/beta-signups', { name: 'R', email: `r${i}@example.com` }, noEmailServer.base);
    assert.strictEqual(last.status, 429);
  });

  await t.test('analytics events', async () => {
    assert.strictEqual((await post('/api/events', { name: 'dashboard_view', sessionId: 'abcdef12-3456', props: { beta: true, nested: { x: 1 } } })).status, 204);
    assert.strictEqual((await post('/api/events', { name: 'evil_event' })).status, 400);
    const ev = (await db.query(`SELECT * FROM events WHERE name = 'dashboard_view'`)).rows[0];
    assert.deepStrictEqual(ev.props, { beta: true });
  });

  await t.test('pages, security headers, CORS, 404s', async () => {
    const home = await get('/');
    assert.strictEqual(home.status, 200);
    assert.match(await home.text(), /Join Our Beta/);
    assert.ok(home.headers.get('content-security-policy'));
    assert.strictEqual(home.headers.get('x-powered-by'), null);
    const dash = await get('/dashboard');
    assert.match(await dash.text(), /Roblox Analytics Dashboard/);
    assert.strictEqual((await get('/api/nope')).status, 404);
    const evil = await get('/api/games', { headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(evil.headers.get('access-control-allow-origin'), null);
  });

  await t.test('errors do not leak internals', async () => {
    const r = await get('/api/games/12/history?days=9999', { headers: { Authorization: `Bearer ${accessToken}` } });
    assert.strictEqual(r.status, 400);
    const text = await r.text();
    assert.ok(!/stack|at \w+ \(/.test(text));
  });
});
