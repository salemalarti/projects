const test = require('node:test');
const assert = require('node:assert');
const { freshDb, startMockServer } = require('./helpers');
const { runScrape } = require('../src/roblox/scraper');
const { createHttpClient } = require('../src/roblox/httpClient');
const gamesRepo = require('../src/repositories/games');
const { sortContent, gameDetails } = require('./fixtures/roblox');

const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

function robloxConfig(base, extra = {}) {
  return {
    sortIds: ['top-playing-now', 'top-trending'],
    extraUniverseIds: [],
    maxGames: 300,
    gamesApiBase: base,
    exploreApiBase: base,
    ...extra,
  };
}
const fastHttp = () => createHttpClient({ requestDelayMs: 0, maxRetries: 2, baseBackoffMs: 1, maxConsecutiveFailures: 5 });

function routesFor({ details = (id) => gameDetails(id), charts = { 'top-playing-now': [1, 2, 3], 'top-trending': [3, 4] } } = {}) {
  return {
    '/explore-api/v1/get-sort-content': (url) => {
      const ids = charts[url.searchParams.get('sortId')];
      return ids ? sortContent(url.searchParams.get('sortId'), ids) : { status: 400, body: { errors: [] } };
    },
    '/v1/games': (url) => ({ data: url.searchParams.get('universeIds').split(',').map(Number).map(details).filter(Boolean) }),
    '/v1/games/votes': (url) => ({ data: url.searchParams.get('universeIds').split(',').map((id) => ({ id: Number(id), upVotes: 80, downVotes: 20 })) }),
  };
}

const count = async (db, table) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

test('scraper pipeline', async (t) => {
  const db = await freshDb();
  t.after(() => db.close());

  await t.test('collects, validates and stores games from charts', async () => {
    const mock = await startMockServer(routesFor());
    const s = await runScrape({ db, robloxConfig: robloxConfig(mock.base), http: fastHttp(), log: quietLog });
    await mock.close();
    assert.strictEqual(s.status, 'success');
    assert.strictEqual(s.found, 4);
    assert.strictEqual(s.stored, 4);
    assert.strictEqual(await count(db, 'games'), 4);
    assert.strictEqual(await count(db, 'game_snapshots'), 4);
    const snap = (await db.query(`SELECT s.* FROM game_snapshots s JOIN games g ON g.id = s.game_id WHERE g.universe_id = 3`)).rows[0];
    assert.deepStrictEqual(snap.source_sorts, ['top-playing-now', 'top-trending']);
    assert.strictEqual(Number(snap.up_votes), 80);
    const stats = (await db.query('SELECT trend FROM game_stats')).rows;
    assert.ok(stats.every((r) => r.trend === 'insufficient_data'), 'one day of data must not produce a trend');
    // batches: details fetched in one request for 4 ids
    assert.strictEqual(mock.calls.filter((c) => c.startsWith('/v1/games?')).length, 1);
  });

  await t.test('running twice on the same day creates no duplicates', async () => {
    const mock = await startMockServer(routesFor({ details: (id) => gameDetails(id, { playing: 1234 }) }));
    const s = await runScrape({ db, robloxConfig: robloxConfig(mock.base), http: fastHttp(), log: quietLog });
    await mock.close();
    assert.strictEqual(s.stored, 4);
    assert.strictEqual(await count(db, 'games'), 4);
    assert.strictEqual(await count(db, 'game_snapshots'), 4);
    const { rows } = await db.query('SELECT DISTINCT concurrent_players FROM game_snapshots');
    assert.deepStrictEqual(rows.map((r) => r.concurrent_players), [1234], 'same-day re-run updates values');
  });

  await t.test('skips malformed records without corrupting others', async () => {
    const mock = await startMockServer(routesFor({
      charts: { 'top-playing-now': [1, 2, 5, 6, 7], 'top-trending': [] },
      details: (id) => (id === 5 ? gameDetails(5, { playing: -3 }) : id === 6 ? gameDetails(6, { name: '' }) : id === 7 ? null : gameDetails(id)),
    }));
    const s = await runScrape({ db, robloxConfig: robloxConfig(mock.base), http: fastHttp(), log: quietLog });
    await mock.close();
    assert.strictEqual(s.status, 'partial');
    assert.strictEqual(s.skipped, 3);
    assert.strictEqual(await count(db, 'games'), 4, 'bad records were not stored');
    assert.ok(s.skippedReasons.some((r) => r.includes('concurrentPlayers')));
    // tracked games (3, 4) keep being collected even though they left the charts
    assert.strictEqual(s.stored, 4);
  });

  await t.test('rejects a sudden drop in total visits', async () => {
    // Make yesterday's snapshot for game 1 look much bigger than today's value.
    await db.query(`UPDATE game_snapshots SET snapshot_date = snapshot_date - 1, captured_at = captured_at - interval '1 day', visits = visits * 100
                    WHERE game_id = (SELECT id FROM games WHERE universe_id = 1)`);
    const mock = await startMockServer(routesFor());
    const s = await runScrape({ db, robloxConfig: robloxConfig(mock.base), http: fastHttp(), log: quietLog });
    await mock.close();
    assert.ok(s.skippedReasons.some((r) => r.startsWith('1: visits dropped')));
  });

  await t.test('handles Roblox being down: retries, fails cleanly, records the run', async () => {
    const mock = await startMockServer({
      '/explore-api/v1/get-sort-content': () => ({ status: 503, body: '' }),
      '/explore-api/v1/get-sorts': () => ({ status: 503, body: '' }),
      '/v1/games': () => ({ status: 503, body: '' }),
    });
    const before = await count(db, 'game_snapshots');
    const s = await runScrape({ db, robloxConfig: robloxConfig(mock.base), http: fastHttp(), log: quietLog });
    await mock.close();
    assert.strictEqual(s.status, 'failed');
    assert.ok(s.httpStats.retries > 0);
    assert.strictEqual(await count(db, 'game_snapshots'), before);
    const run = (await db.query('SELECT status, error_summary FROM scrape_runs ORDER BY id DESC LIMIT 1')).rows[0];
    assert.strictEqual(run.status, 'failed');
    assert.ok(run.error_summary);
  });

  await t.test('handles malformed (non-JSON / wrong shape) responses', async () => {
    const mock = await startMockServer({
      '/explore-api/v1/get-sort-content': () => ({ status: 200, body: '<html>not json</html>' }),
      '/explore-api/v1/get-sorts': () => ({ unexpected: 'shape' }),
      '/v1/games': () => ({ notData: [] }),
    });
    const s = await runScrape({ db, robloxConfig: robloxConfig(mock.base), http: fastHttp(), log: quietLog });
    await mock.close();
    assert.strictEqual(s.status, 'failed');
    assert.match(s.error, /missing "data" array/);
  });

  await t.test('falls back to get-sorts when individual charts fail', async () => {
    const mock = await startMockServer({
      ...routesFor(),
      '/explore-api/v1/get-sort-content': () => ({ status: 400, body: {} }),
      '/explore-api/v1/get-sorts': () => ({ sorts: [{ sortId: 'top-earning', contentType: 'Games', games: [{ universeId: 9 }, { universeId: 10, isSponsored: true }] }] }),
    });
    const s = await runScrape({ db, robloxConfig: robloxConfig(mock.base), http: fastHttp(), log: quietLog });
    await mock.close();
    assert.notStrictEqual(s.status, 'failed');
    const ids = (await db.query('SELECT universe_id FROM games ORDER BY universe_id')).rows.map((r) => Number(r.universe_id));
    assert.ok(ids.includes(9));
    assert.ok(!ids.includes(10), 'sponsored (ad) entries are excluded');
  });

  await t.test('trend calculation from 15 days of stored history', async () => {
    const gameId = Number((await db.query('SELECT id FROM games WHERE universe_id = 2')).rows[0].id);
    await db.query('DELETE FROM game_snapshots WHERE game_id = $1', [gameId]);
    let visits = 1_000_000;
    for (let d = 14; d >= 0; d -= 1) {
      visits += d >= 7 ? 1000 : 3000; // faster growth in the last 7 days
      await db.query(
        `INSERT INTO game_snapshots (game_id, snapshot_date, captured_at, visits, concurrent_players)
         VALUES ($1, (now() - make_interval(days => $2))::date, now() - make_interval(days => $2), $3, 100)`,
        [gameId, d, visits],
      );
    }
    await gamesRepo.recomputeStats(db, { thresholdPct: 10 });
    const st = (await db.query('SELECT * FROM game_stats WHERE game_id = $1', [gameId])).rows[0];
    assert.strictEqual(st.trend, 'up');
    assert.strictEqual(Math.round(st.visits_growth_7d_pct), 200);
    assert.strictEqual(st.snapshot_count, 15);
  });
});
