process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeGame } = require('../src/roblox/normalizer');
const { validateGame, checkAgainstPrevious } = require('../src/roblox/validators');
const { extractChartGames } = require('../src/roblox/provider');
const { gameDetails } = require('./fixtures/roblox');
const { validateSignup } = require('../src/middleware/validate');

test('normalizes a Roblox games API object', () => {
  const g = normalizeGame(gameDetails(3), { id: 3, upVotes: 90, downVotes: 10 }, ['top-trending', 'top-playing-now', 'top-trending']);
  assert.strictEqual(g.universeId, 3);
  assert.strictEqual(g.rootPlaceId, 30);
  assert.strictEqual(g.genre, null, '"All" means no genre');
  assert.strictEqual(g.genreL1, 'Roleplay & Avatar Sim');
  assert.strictEqual(g.concurrentPlayers, 3000);
  assert.strictEqual(g.upVotes, 90);
  assert.deepStrictEqual(g.sourceSorts, ['top-playing-now', 'top-trending']);
  assert.deepStrictEqual(validateGame(g), []);
});

test('missing votes stay null (not zero)', () => {
  const g = normalizeGame(gameDetails(2));
  assert.strictEqual(g.upVotes, null);
  assert.deepStrictEqual(validateGame(g), []);
});

test('rejects malformed records', () => {
  const bad = [
    gameDetails(1, { id: -5 }),
    gameDetails(1, { id: 'abc' }),
    gameDetails(1, { name: '   ' }),
    gameDetails(1, { visits: -1 }),
    gameDetails(1, { playing: 900_000_000 }),
    gameDetails(1, { playing: undefined }),
    gameDetails(1, { visits: '12x' }),
    gameDetails(1, { created: 'not a date' }),
    gameDetails(1, { created: '1999-01-01T00:00:00Z' }),
    gameDetails(1, { favoritedCount: 1.5 }),
  ];
  for (const raw of bad) assert.ok(validateGame(normalizeGame(raw)).length > 0, JSON.stringify(raw));
});

test('flags a big drop in total visits', () => {
  const g = normalizeGame(gameDetails(1, { visits: 500 }));
  assert.strictEqual(checkAgainstPrevious(g, { visits: 1000 }).length, 1);
  assert.strictEqual(checkAgainstPrevious(g, { visits: 501 }).length, 0);
  assert.strictEqual(checkAgainstPrevious(g, null).length, 0);
});

test('extracts chart games from single-sort and multi-sort shapes', () => {
  assert.strictEqual(extractChartGames({ sortId: 'a', games: [{ universeId: 1 }] })[0]._sortId, 'a');
  const multi = extractChartGames({ sorts: [
    { sortId: 'x', contentType: 'Games', games: [{ universeId: 1 }, { universeId: 2 }] },
    { sortId: 'filters', contentType: 'Filters', filters: [] },
  ] });
  assert.strictEqual(multi.length, 2);
  assert.deepStrictEqual(extractChartGames(null), []);
  assert.deepStrictEqual(extractChartGames({ unexpected: true }), []);
});

test('signup validation', () => {
  assert.throws(() => validateSignup({ name: '', email: 'x' }), (e) => e.status === 400 && !!e.details.name && !!e.details.email);
  assert.throws(() => validateSignup({ name: 'A', email: 'a@b' }), (e) => !!e.details.email);
  assert.throws(() => validateSignup({ name: 'A', email: 'a@b.co', interest: 'x'.repeat(2000) }), (e) => e.status === 400);
  const ok = validateSignup({ name: ' Sam ', email: ' Sam@Example.COM ' });
  assert.strictEqual(ok.name, 'Sam');
  assert.strictEqual(ok.email, 'sam@example.com');
  assert.strictEqual(ok.isBot, false);
  assert.strictEqual(validateSignup({ name: 'A', email: 'a@b.co', website: 'spam.com' }).isBot, true);
});
