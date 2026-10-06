// All SQL for games, snapshots and derived stats. Parameterized queries only.
const { toInt } = require('../db');
const { computeGameTrend } = require('../analytics/trends');

async function upsertGame(db, g, seenAt) {
  const { rows } = await db.query(
    `INSERT INTO games (universe_id, root_place_id, name, description, genre, genre_l1, genre_l2,
                        creator_name, creator_type, max_players, release_date, roblox_updated_at,
                        first_seen_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
     ON CONFLICT (universe_id) DO UPDATE SET
       root_place_id = EXCLUDED.root_place_id,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       genre = EXCLUDED.genre,
       genre_l1 = EXCLUDED.genre_l1,
       genre_l2 = EXCLUDED.genre_l2,
       creator_name = EXCLUDED.creator_name,
       creator_type = EXCLUDED.creator_type,
       max_players = EXCLUDED.max_players,
       release_date = EXCLUDED.release_date,
       roblox_updated_at = EXCLUDED.roblox_updated_at,
       last_seen_at = EXCLUDED.last_seen_at,
       updated_at = now()
     RETURNING id`,
    [
      g.universeId, g.rootPlaceId, g.name, g.description, g.genre, g.genreL1, g.genreL2,
      g.creatorName, g.creatorType, g.maxPlayers, g.releaseDate, g.robloxUpdatedAt, seenAt,
    ],
  );
  return toInt(rows[0].id);
}

// Most recent snapshot from an EARLIER day (used for sanity checks).
async function getPreviousSnapshot(db, universeId, snapshotDate) {
  const { rows } = await db.query(
    `SELECT s.visits, s.concurrent_players
       FROM game_snapshots s JOIN games g ON g.id = s.game_id
      WHERE g.universe_id = $1 AND s.snapshot_date < $2
      ORDER BY s.snapshot_date DESC LIMIT 1`,
    [universeId, snapshotDate],
  );
  return rows[0] ? { visits: toInt(rows[0].visits), concurrentPlayers: toInt(rows[0].concurrent_players) } : null;
}

async function upsertSnapshot(db, gameId, g, capturedAt) {
  const snapshotDate = capturedAt.slice(0, 10); // UTC date
  await db.query(
    `INSERT INTO game_snapshots (game_id, snapshot_date, captured_at, visits, concurrent_players,
                                 favorites, up_votes, down_votes, source_sorts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (game_id, snapshot_date) DO UPDATE SET
       captured_at = EXCLUDED.captured_at,
       visits = EXCLUDED.visits,
       concurrent_players = EXCLUDED.concurrent_players,
       favorites = EXCLUDED.favorites,
       up_votes = EXCLUDED.up_votes,
       down_votes = EXCLUDED.down_votes,
       source_sorts = (SELECT ARRAY(SELECT DISTINCT unnest(game_snapshots.source_sorts || EXCLUDED.source_sorts) ORDER BY 1))`,
    [gameId, snapshotDate, capturedAt, g.visits, g.concurrentPlayers, g.favorites, g.upVotes, g.downVotes, g.sourceSorts],
  );
}

// Universe IDs we already track and saw recently, so their history keeps
// growing even after they drop off the Roblox charts.
async function listTrackedUniverseIds(db, { seenWithinDays = 30, limit = 1000 } = {}) {
  const { rows } = await db.query(
    `SELECT universe_id FROM games
      WHERE last_seen_at > now() - make_interval(days => $1)
      ORDER BY last_seen_at DESC LIMIT $2`,
    [seenWithinDays, limit],
  );
  return rows.map((r) => toInt(r.universe_id));
}

// Recalculates game_stats for every game with snapshots in the last 75 days.
async function recomputeStats(db, { thresholdPct }) {
  const { rows } = await db.query(
    `SELECT game_id, captured_at, visits, concurrent_players, favorites, up_votes, down_votes
       FROM game_snapshots
      WHERE captured_at > now() - interval '75 days'
      ORDER BY game_id, captured_at`,
  );
  const counts = await db.query(
    `SELECT game_id, count(*) AS n, min(captured_at) AS first_at FROM game_snapshots GROUP BY game_id`,
  );
  const countByGame = new Map(counts.rows.map((r) => [toInt(r.game_id), r]));

  const byGame = new Map();
  for (const r of rows) {
    const id = toInt(r.game_id);
    if (!byGame.has(id)) byGame.set(id, []);
    byGame.get(id).push(r);
  }

  const records = [];
  for (const [gameId, snaps] of byGame) {
    const trend = computeGameTrend(
      snaps.map((s) => ({ capturedAt: s.captured_at, visits: toInt(s.visits), concurrentPlayers: toInt(s.concurrent_players) })),
      { thresholdPct },
    );
    const latest = snaps[snaps.length - 1];
    const c = countByGame.get(gameId);
    records.push({
      game_id: gameId,
      latest_visits: toInt(latest.visits),
      latest_concurrent: toInt(latest.concurrent_players),
      latest_favorites: toInt(latest.favorites),
      latest_up_votes: toInt(latest.up_votes),
      latest_down_votes: toInt(latest.down_votes),
      latest_captured_at: new Date(latest.captured_at).toISOString(),
      first_captured_at: c ? new Date(c.first_at).toISOString() : trend.firstCapturedAt,
      snapshot_count: c ? toInt(c.n) : trend.snapshotCount,
      visits_per_day_7d: trend.visitsPerDay7d,
      visits_growth_7d_pct: trend.visitsGrowth7dPct,
      visits_growth_30d_pct: trend.visitsGrowth30dPct,
      concurrent_change_7d_pct: trend.concurrentChange7dPct,
      trend: trend.trend,
    });
  }
  if (!records.length) return 0;

  await db.query(
    `INSERT INTO game_stats (game_id, latest_visits, latest_concurrent, latest_favorites, latest_up_votes,
                             latest_down_votes, latest_captured_at, first_captured_at, snapshot_count,
                             visits_per_day_7d, visits_growth_7d_pct, visits_growth_30d_pct,
                             concurrent_change_7d_pct, trend, computed_at)
     SELECT game_id, latest_visits, latest_concurrent, latest_favorites, latest_up_votes,
            latest_down_votes, latest_captured_at, first_captured_at, snapshot_count,
            visits_per_day_7d, visits_growth_7d_pct, visits_growth_30d_pct,
            concurrent_change_7d_pct, trend, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(
            game_id BIGINT, latest_visits BIGINT, latest_concurrent INTEGER, latest_favorites BIGINT,
            latest_up_votes BIGINT, latest_down_votes BIGINT, latest_captured_at TIMESTAMPTZ,
            first_captured_at TIMESTAMPTZ, snapshot_count INTEGER, visits_per_day_7d DOUBLE PRECISION,
            visits_growth_7d_pct DOUBLE PRECISION, visits_growth_30d_pct DOUBLE PRECISION,
            concurrent_change_7d_pct DOUBLE PRECISION, trend TEXT)
     ON CONFLICT (game_id) DO UPDATE SET
       latest_visits = EXCLUDED.latest_visits,
       latest_concurrent = EXCLUDED.latest_concurrent,
       latest_favorites = EXCLUDED.latest_favorites,
       latest_up_votes = EXCLUDED.latest_up_votes,
       latest_down_votes = EXCLUDED.latest_down_votes,
       latest_captured_at = EXCLUDED.latest_captured_at,
       first_captured_at = EXCLUDED.first_captured_at,
       snapshot_count = EXCLUDED.snapshot_count,
       visits_per_day_7d = EXCLUDED.visits_per_day_7d,
       visits_growth_7d_pct = EXCLUDED.visits_growth_7d_pct,
       visits_growth_30d_pct = EXCLUDED.visits_growth_30d_pct,
       concurrent_change_7d_pct = EXCLUDED.concurrent_change_7d_pct,
       trend = EXCLUDED.trend,
       computed_at = now()`,
    [JSON.stringify(records)],
  );
  return records.length;
}

// ---------------------------------------------------------------------------
// Read side (API)
// ---------------------------------------------------------------------------
const GAME_COLUMNS = `
  g.universe_id, g.root_place_id, g.name, g.description, g.genre, g.genre_l1, g.genre_l2,
  g.creator_name, g.creator_type, g.max_players, g.release_date, g.roblox_updated_at,
  g.first_seen_at, g.last_seen_at,
  s.latest_visits, s.latest_concurrent, s.latest_favorites, s.latest_up_votes, s.latest_down_votes,
  s.latest_captured_at, s.first_captured_at, s.snapshot_count, s.visits_per_day_7d,
  s.visits_growth_7d_pct, s.visits_growth_30d_pct, s.concurrent_change_7d_pct, s.trend`;

const num = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

function mapGameRow(r, staleAfterDays) {
  const latestAt = r.latest_captured_at ? new Date(r.latest_captured_at) : null;
  const ups = num(r.latest_up_votes);
  const downs = num(r.latest_down_votes);
  return {
    universeId: num(r.universe_id),
    rootPlaceId: num(r.root_place_id),
    name: r.name,
    description: r.description,
    genre: r.genre_l1 || r.genre || null,
    subgenre: r.genre_l2 || null,
    creator: r.creator_name ? { name: r.creator_name, type: r.creator_type } : null,
    maxPlayers: num(r.max_players),
    releaseDate: iso(r.release_date),
    lastPublishedAt: iso(r.roblox_updated_at),
    robloxUrl: r.root_place_id ? `https://www.roblox.com/games/${r.root_place_id}` : null,
    visits: num(r.latest_visits),
    concurrentPlayers: num(r.latest_concurrent),
    favorites: num(r.latest_favorites),
    upVotes: ups,
    downVotes: downs,
    likeRatioPct: ups !== null && downs !== null && ups + downs > 0 ? Math.round((ups / (ups + downs)) * 1000) / 10 : null,
    trend: r.trend || 'insufficient_data',
    visitsPerDay7d: num(r.visits_per_day_7d),
    visitsGrowth7dPct: num(r.visits_growth_7d_pct),
    visitsGrowth30dPct: num(r.visits_growth_30d_pct),
    concurrentChange7dPct: num(r.concurrent_change_7d_pct),
    snapshotCount: num(r.snapshot_count) || 0,
    trackedSince: iso(r.first_captured_at),
    dataCapturedAt: iso(latestAt),
    isStale: !latestAt || Date.now() - latestAt.getTime() > staleAfterDays * 86400000,
    // Roblox does not publish these. Never fill them with guesses.
    retentionRate: null,
    avgSessionLength: null,
    monetizationMethods: null,
  };
}

const SORTS = {
  playing: 's.latest_concurrent DESC NULLS LAST',
  visits: 's.latest_visits DESC NULLS LAST',
  growth: 's.visits_growth_7d_pct DESC NULLS LAST, s.latest_concurrent DESC NULLS LAST',
  newest: 'g.release_date DESC NULLS LAST',
};

async function listGames(db, { sort = 'playing', genre = null, trend = null, limit = 50, offset = 0, includeStale = false, staleAfterDays }) {
  const where = ['s.game_id IS NOT NULL'];
  const params = [];
  if (genre) {
    params.push(genre);
    where.push(`COALESCE(g.genre_l1, g.genre) = $${params.length}`);
  }
  if (trend) {
    params.push(trend);
    where.push(`s.trend = $${params.length}`);
  }
  if (!includeStale) {
    params.push(staleAfterDays);
    where.push(`s.latest_captured_at > now() - make_interval(days => $${params.length})`);
  }
  const whereSql = where.join(' AND ');
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT ${GAME_COLUMNS}, count(*) OVER () AS total
       FROM games g LEFT JOIN game_stats s ON s.game_id = g.id
      WHERE ${whereSql}
      ORDER BY ${SORTS[sort] || SORTS.playing}, g.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows.length ? Number(rows[0].total) : 0, games: rows.map((r) => mapGameRow(r, staleAfterDays)) };
}

async function getGame(db, universeId, { staleAfterDays }) {
  const { rows } = await db.query(
    `SELECT ${GAME_COLUMNS} FROM games g LEFT JOIN game_stats s ON s.game_id = g.id WHERE g.universe_id = $1`,
    [universeId],
  );
  return rows[0] ? mapGameRow(rows[0], staleAfterDays) : null;
}

async function getHistory(db, universeId, { days = 90 } = {}) {
  const { rows } = await db.query(
    `SELECT s.snapshot_date, s.captured_at, s.visits, s.concurrent_players, s.favorites,
            s.up_votes, s.down_votes, s.source_sorts
       FROM game_snapshots s JOIN games g ON g.id = s.game_id
      WHERE g.universe_id = $1 AND s.captured_at > now() - make_interval(days => $2)
      ORDER BY s.captured_at`,
    [universeId, days],
  );
  return rows.map((r) => ({
    date: typeof r.snapshot_date === 'string' ? r.snapshot_date : new Date(r.snapshot_date).toISOString().slice(0, 10),
    capturedAt: iso(r.captured_at),
    visits: num(r.visits),
    concurrentPlayers: num(r.concurrent_players),
    favorites: num(r.favorites),
    upVotes: num(r.up_votes),
    downVotes: num(r.down_votes),
    charts: r.source_sorts || [],
  }));
}

async function trendSummary(db, { staleAfterDays, limit = 10 }) {
  const fresh = `s.latest_captured_at > now() - make_interval(days => $1)`;
  const counts = await db.query(
    `SELECT s.trend, count(*) AS n FROM game_stats s WHERE ${fresh} GROUP BY s.trend`,
    [staleAfterDays],
  );
  const pick = async (trend, order) => {
    const { rows } = await db.query(
      `SELECT ${GAME_COLUMNS} FROM games g JOIN game_stats s ON s.game_id = g.id
        WHERE ${fresh} AND s.trend = $2 ORDER BY ${order}, g.id LIMIT $3`,
      [staleAfterDays, trend, limit],
    );
    return rows.map((r) => mapGameRow(r, staleAfterDays));
  };
  const byTrend = { up: 0, stable: 0, down: 0, insufficient_data: 0 };
  for (const r of counts.rows) byTrend[r.trend] = Number(r.n);
  return {
    counts: byTrend,
    rising: await pick('up', 's.visits_growth_7d_pct DESC'),
    falling: await pick('down', 's.visits_growth_7d_pct ASC'),
  };
}

async function genreSummary(db, { staleAfterDays }) {
  const { rows } = await db.query(
    `SELECT COALESCE(g.genre_l1, g.genre) AS genre,
            count(*) AS games,
            sum(s.latest_concurrent) AS concurrent_players,
            sum(s.latest_visits) AS visits,
            count(*) FILTER (WHERE s.trend = 'up') AS rising,
            count(*) FILTER (WHERE s.trend = 'down') AS falling,
            count(*) FILTER (WHERE s.visits_growth_7d_pct IS NOT NULL) AS with_growth,
            avg(s.visits_growth_7d_pct) AS avg_growth_7d_pct
       FROM games g JOIN game_stats s ON s.game_id = g.id
      WHERE s.latest_captured_at > now() - make_interval(days => $1)
      GROUP BY 1
      ORDER BY sum(s.latest_concurrent) DESC NULLS LAST`,
    [staleAfterDays],
  );
  return rows.map((r) => ({
    genre: r.genre || 'Unclassified',
    games: num(r.games),
    concurrentPlayers: num(r.concurrent_players),
    visits: num(r.visits),
    rising: num(r.rising),
    falling: num(r.falling),
    gamesWithGrowthData: num(r.with_growth),
    avgVisitsGrowth7dPct: r.avg_growth_7d_pct === null ? null : Math.round(Number(r.avg_growth_7d_pct) * 100) / 100,
  }));
}

module.exports = {
  upsertGame,
  upsertSnapshot,
  getPreviousSnapshot,
  listTrackedUniverseIds,
  recomputeStats,
  listGames,
  getGame,
  getHistory,
  trendSummary,
  genreSummary,
  SORTS,
};
