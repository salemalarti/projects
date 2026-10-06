process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { computeGameTrend, classify, DAY_MS } = require('../src/analytics/trends');

const T0 = Date.parse('2026-09-01T03:00:00Z');
// visitsPerDay(dayIndex) -> visits gained on that day
function series(days, visitsPerDay, concurrent = () => 1000) {
  const out = [];
  let visits = 1_000_000;
  for (let d = 0; d < days; d += 1) {
    if (d > 0) visits += visitsPerDay(d);
    out.push({ capturedAt: new Date(T0 + d * DAY_MS).toISOString(), visits, concurrentPlayers: concurrent(d) });
  }
  return out;
}

test('fewer than 2 snapshots -> insufficient_data', () => {
  assert.strictEqual(computeGameTrend([]).trend, 'insufficient_data');
  assert.strictEqual(computeGameTrend(series(1, () => 0)).trend, 'insufficient_data');
});

test('8 days of history gives visits/day but no trend yet', () => {
  const r = computeGameTrend(series(8, () => 1000));
  assert.strictEqual(r.visitsPerDay7d, 1000);
  assert.strictEqual(r.visitsGrowth7dPct, null);
  assert.strictEqual(r.trend, 'insufficient_data');
});

test('accelerating visits -> up', () => {
  const r = computeGameTrend(series(15, (d) => (d <= 7 ? 1000 : 2000)));
  assert.strictEqual(r.visitsGrowth7dPct, 100);
  assert.strictEqual(r.trend, 'up');
});

test('steady visits -> stable; small wobble stays stable', () => {
  assert.strictEqual(computeGameTrend(series(15, () => 1000)).trend, 'stable');
  assert.strictEqual(computeGameTrend(series(15, (d) => (d <= 7 ? 1000 : 1050))).trend, 'stable');
});

test('slowing visits -> down', () => {
  const r = computeGameTrend(series(15, (d) => (d <= 7 ? 1000 : 500)));
  assert.strictEqual(r.visitsGrowth7dPct, -50);
  assert.strictEqual(r.trend, 'down');
});

test('total visits still increasing but slower is down, not up', () => {
  const r = computeGameTrend(series(15, (d) => (d <= 7 ? 10000 : 100)));
  assert.strictEqual(r.trend, 'down');
});

test('gaps in history -> insufficient_data rather than a guess', () => {
  const s = series(15, () => 1000).filter((_, i) => i === 0 || i === 14);
  assert.strictEqual(computeGameTrend(s).trend, 'insufficient_data');
});

test('negative visit gains (bad data) are ignored', () => {
  const s = series(15, () => 1000);
  s[7].visits = 0;
  assert.strictEqual(computeGameTrend(s).visitsGrowth7dPct, null);
});

test('30-day growth needs ~60 days', () => {
  assert.strictEqual(computeGameTrend(series(40, () => 1000)).visitsGrowth30dPct, null);
  assert.strictEqual(computeGameTrend(series(61, (d) => (d <= 30 ? 1000 : 1200))).visitsGrowth30dPct, 20);
});

test('concurrent change over 7 days', () => {
  const r = computeGameTrend(series(8, () => 1000, (d) => (d === 7 ? 1500 : 1000)));
  assert.strictEqual(r.concurrentChange7dPct, 50);
});

test('classify thresholds', () => {
  assert.strictEqual(classify(10, 10), 'up');
  assert.strictEqual(classify(9.99, 10), 'stable');
  assert.strictEqual(classify(-10, 10), 'down');
  assert.strictEqual(classify(null, 10), 'insufficient_data');
});
