process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { createHttpClient, CircuitOpenError, parseRetryAfter } = require('../src/roblox/httpClient');

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      headers: { get: (h) => (r.headers || {})[h.toLowerCase()] || null },
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const sleeps = [];
const fakeSleep = async (ms) => { sleeps.push(ms); };
const client = (fetchImpl, extra = {}) => createHttpClient({ fetchImpl, sleepImpl: fakeSleep, requestDelayMs: 0, ...extra });

test('returns parsed JSON', async () => {
  const f = fakeFetch([{ status: 200, body: { ok: 1 } }]);
  assert.deepStrictEqual(await client(f).getJson('https://x.test/a'), { ok: 1 });
});

test('retries 5xx and network errors with backoff, then succeeds', async () => {
  sleeps.length = 0;
  const f = fakeFetch([{ status: 503, body: '' }, new Error('ECONNRESET'), { status: 200, body: { ok: 2 } }]);
  const c = client(f, { maxRetries: 3 });
  assert.deepStrictEqual(await c.getJson('https://x.test/a'), { ok: 2 });
  assert.strictEqual(f.calls.length, 3);
  assert.strictEqual(c.stats.retries, 2);
  assert.ok(sleeps[0] >= 1000 && sleeps[1] >= 2000, `exponential backoff: ${sleeps}`);
});

test('honors Retry-After on 429', async () => {
  sleeps.length = 0;
  const f = fakeFetch([{ status: 429, headers: { 'retry-after': '7' }, body: '' }, { status: 200, body: {} }]);
  const c = client(f);
  await c.getJson('https://x.test/a');
  assert.ok(sleeps[0] >= 7000);
  assert.strictEqual(c.stats.rateLimited, 1);
});

test('gives up after maxRetries', async () => {
  const f = fakeFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
  await assert.rejects(client(f, { maxRetries: 2 }).getJson('https://x.test/a'), /HTTP 500/);
  assert.strictEqual(f.calls.length, 3);
});

test('does not retry 4xx client errors', async () => {
  const f = fakeFetch([{ status: 404 }]);
  await assert.rejects(client(f).getJson('https://x.test/a'), /HTTP 404/);
  assert.strictEqual(f.calls.length, 1);
});

test('malformed JSON is an error, not data', async () => {
  const f = fakeFetch([{ status: 200, body: '<html>oops' }]);
  await assert.rejects(client(f).getJson('https://x.test/a'), /not valid JSON/);
});

test('circuit breaker stops requests after repeated failures', async () => {
  const f = fakeFetch([{ status: 400 }, { status: 400 }, { status: 400 }]);
  const c = client(f, { maxConsecutiveFailures: 2 });
  await assert.rejects(c.getJson('https://x.test/a'));
  await assert.rejects(c.getJson('https://x.test/a'));
  await assert.rejects(c.getJson('https://x.test/a'), CircuitOpenError);
  assert.strictEqual(f.calls.length, 2);
});

test('spaces requests to the same host', async () => {
  sleeps.length = 0;
  const f = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
  const c = createHttpClient({ fetchImpl: f, sleepImpl: fakeSleep, requestDelayMs: 250 });
  await c.getJson('https://x.test/a');
  await c.getJson('https://x.test/b');
  assert.ok(sleeps.some((ms) => ms > 200 && ms <= 250));
});

test('parseRetryAfter', () => {
  assert.strictEqual(parseRetryAfter('3'), 3000);
  assert.strictEqual(parseRetryAfter(null), null);
});
