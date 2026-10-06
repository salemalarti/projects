const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const games = require('../repositories/games');
const runs = require('../repositories/scrapeRuns');
const { asyncHandler, HttpError } = require('../middleware/errors');
const { intParam, universeIdParam } = require('../middleware/validate');
const { requireBetaAccess } = require('../middleware/betaAccess');

const router = express.Router();
const staleAfterDays = config.trends.staleAfterDays;
const TRENDS = ['up', 'stable', 'down', 'insufficient_data'];

// Every data response carries when the data was last collected.
async function freshness(db) {
  const run = await runs.lastSuccessfulRun(db);
  return { dataUpdatedAt: run ? run.finishedAt : null, staleAfterDays };
}

router.get('/games', asyncHandler(async (req, res) => {
  const sort = req.query.sort || 'playing';
  if (!games.SORTS[sort]) throw new HttpError(400, `sort must be one of: ${Object.keys(games.SORTS).join(', ')}`);
  const trend = req.query.trend || null;
  if (trend && !TRENDS.includes(trend)) throw new HttpError(400, `trend must be one of: ${TRENDS.join(', ')}`);
  const genre = typeof req.query.genre === 'string' && req.query.genre.trim() ? req.query.genre.trim().slice(0, 100) : null;
  const limit = intParam(req.query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 });
  const offset = intParam(req.query.offset, { name: 'offset', min: 0, max: 10000, fallback: 0 });
  const includeStale = req.query.includeStale === 'true';
  const db = await getDb();
  const { total, games: data } = await games.listGames(db, { sort, genre, trend, limit, offset, includeStale, staleAfterDays });
  res.json({ data, meta: { total, limit, offset, sort, ...(await freshness(db)) } });
}));

router.get('/games/:id', asyncHandler(async (req, res) => {
  const db = await getDb();
  const game = await games.getGame(db, universeIdParam(req.params.id), { staleAfterDays });
  if (!game) throw new HttpError(404, 'Game not found');
  res.json({ data: game, meta: await freshness(db) });
}));

// Full history is a beta feature.
router.get('/games/:id/history', requireBetaAccess, asyncHandler(async (req, res) => {
  const universeId = universeIdParam(req.params.id);
  const days = intParam(req.query.days, { name: 'days', min: 1, max: 365, fallback: 90 });
  const db = await getDb();
  const game = await games.getGame(db, universeId, { staleAfterDays });
  if (!game) throw new HttpError(404, 'Game not found');
  res.json({ data: await games.getHistory(db, universeId, { days }), meta: { universeId, name: game.name, days, ...(await freshness(db)) } });
}));

router.get('/trends', asyncHandler(async (req, res) => {
  const limit = intParam(req.query.limit, { name: 'limit', min: 1, max: 50, fallback: 10 });
  const db = await getDb();
  const summary = await games.trendSummary(db, { staleAfterDays, limit });
  res.json({
    data: summary,
    meta: {
      method: 'Visits gained per day over the last 7 days compared with the 7 days before.',
      thresholdPct: config.trends.thresholdPct,
      minimumHistoryDays: 14,
      ...(await freshness(db)),
    },
  });
}));

router.get('/genres', asyncHandler(async (req, res) => {
  const db = await getDb();
  res.json({ data: await games.genreSummary(db, { staleAfterDays }), meta: await freshness(db) });
}));

router.get('/status', asyncHandler(async (req, res) => {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM games) AS games, (SELECT count(*) FROM game_snapshots) AS snapshots`,
  );
  res.json({ data: { gamesTracked: Number(rows[0].games), snapshots: Number(rows[0].snapshots) }, meta: await freshness(db) });
}));

module.exports = router;
