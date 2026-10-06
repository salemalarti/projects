// Data collection pipeline:
//   Roblox provider -> normalizer -> validators -> database -> trend recalculation
const config = require('../config');
const logger = require('../logger');
const { createHttpClient, CircuitOpenError } = require('./httpClient');
const { createRobloxProvider } = require('./provider');
const { normalizeGame } = require('./normalizer');
const { validateGame, checkAgainstPrevious } = require('./validators');
const gamesRepo = require('../repositories/games');
const runsRepo = require('../repositories/scrapeRuns');

function parseId(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Step 1: decide which universes to collect, remembering which charts listed them.
async function discoverUniverses({ provider, db, robloxConfig, log }) {
  const sortsById = new Map(); // universeId -> Set(sortId)
  const add = (id, sortId) => {
    if (!id) return;
    if (!sortsById.has(id)) sortsById.set(id, new Set());
    if (sortId) sortsById.get(id).add(sortId);
  };

  let chartSuccesses = 0;
  for (const sortId of robloxConfig.sortIds) {
    try {
      const games = await provider.getChartSort(sortId);
      const valid = games.filter((g) => !g.isSponsored && parseId(g.universeId));
      valid.forEach((g) => add(parseId(g.universeId), sortId));
      log.info(`Chart "${sortId}": ${valid.length} games`);
      if (valid.length) chartSuccesses += 1;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      log.warn(`Chart "${sortId}" unavailable, skipping`, { reason: err.message });
    }
  }

  if (chartSuccesses === 0) {
    try {
      const games = await provider.getAllChartSorts();
      games.filter((g) => !g.isSponsored && parseId(g.universeId)).forEach((g) => add(parseId(g.universeId), g._sortId));
      log.info(`Fallback chart listing: ${games.length} games`);
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      log.warn('Fallback chart listing unavailable', { reason: err.message });
    }
  }

  // Keep tracking games we already follow so their history continues.
  const chartIds = [...sortsById.keys()];
  const tracked = await gamesRepo.listTrackedUniverseIds(db);
  tracked.forEach((id) => add(id));
  robloxConfig.extraUniverseIds.map(parseId).forEach((id) => add(id));

  // Prioritize: charted games first, then tracked/extra ones, capped.
  const ordered = [...new Set([...chartIds, ...sortsById.keys()])].slice(0, robloxConfig.maxGames);
  return { universeIds: ordered, sortsById };
}

async function runScrape({ db, robloxConfig = config.roblox, http = null, log = logger, now = () => new Date() } = {}) {
  const started = Date.now();
  const client = http || createHttpClient({
    requestDelayMs: robloxConfig.requestDelayMs,
    maxRetries: robloxConfig.maxRetries,
    timeoutMs: robloxConfig.timeoutMs,
    maxConsecutiveFailures: robloxConfig.maxConsecutiveFailures,
    userAgent: `RobloxAnalyticsMVP/1.1 (+${config.baseUrl})`,
  });
  const provider = createRobloxProvider({
    http: client,
    gamesApiBase: robloxConfig.gamesApiBase,
    exploreApiBase: robloxConfig.exploreApiBase,
  });

  const runId = await runsRepo.startRun(db);
  const summary = { runId, found: 0, stored: 0, skipped: 0, skippedReasons: [], status: 'failed', durationSec: 0 };
  log.info('Starting Roblox data collection...');

  try {
    const { universeIds, sortsById } = await discoverUniverses({ provider, db, robloxConfig, log });
    summary.found = universeIds.length;
    log.info(`Found ${universeIds.length} games`);
    if (!universeIds.length) throw new Error('No games discovered: Roblox charts returned nothing and no games are tracked yet');

    const details = await provider.getGameDetails(universeIds);
    let votes = [];
    try {
      votes = await provider.getGameVotes(universeIds);
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      log.warn('Vote counts unavailable this run; storing games without votes', { reason: err.message });
    }
    const votesById = new Map(votes.map((v) => [Number(v.id), v]));
    const detailsById = new Map(details.map((d) => [Number(d.id), d]));

    const capturedAt = now().toISOString();
    const snapshotDate = capturedAt.slice(0, 10);
    for (let i = 0; i < universeIds.length; i += 1) {
      const id = universeIds[i];
      log.debug(`Processing ${i + 1}/${universeIds.length}...`);
      if ((i + 1) % 25 === 0 || i + 1 === universeIds.length) log.info(`Processing ${i + 1}/${universeIds.length}...`);
      const raw = detailsById.get(id);
      if (!raw) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${id}: not returned by Roblox (deleted or private?)`);
        continue;
      }
      const game = normalizeGame(raw, votesById.get(id), [...(sortsById.get(id) || [])]);
      let problems = validateGame(game);
      if (!problems.length) problems = checkAgainstPrevious(game, await gamesRepo.getPreviousSnapshot(db, id, snapshotDate));
      if (problems.length) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${id}: ${problems.join('; ')}`);
        log.warn(`Skipping universe ${id}`, { problems });
        continue;
      }
      try {
        const gameId = await gamesRepo.upsertGame(db, game, capturedAt);
        await gamesRepo.upsertSnapshot(db, gameId, game, capturedAt);
        summary.stored += 1;
      } catch (err) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${id}: database error ${err.message}`);
        log.error(`Could not store universe ${id}`, { reason: err.message });
      }
    }

    const statsCount = await gamesRepo.recomputeStats(db, { thresholdPct: config.trends.thresholdPct });
    log.info(`Recalculated trends for ${statsCount} games`);
    summary.status = summary.stored === 0 ? 'failed' : summary.skipped > 0 ? 'partial' : 'success';
  } catch (err) {
    summary.error = err.message;
    log.error('Data collection failed', { reason: err.message });
  }

  summary.durationSec = Math.round((Date.now() - started) / 100) / 10;
  summary.httpStats = { ...client.stats };
  const errorSummary = summary.error || (summary.skippedReasons.length ? summary.skippedReasons.slice(0, 20).join('\n') : null);
  await runsRepo.finishRun(db, runId, { status: summary.status, found: summary.found, stored: summary.stored, skipped: summary.skipped, errorSummary });

  log.info(`Successfully stored ${summary.stored} games`);
  log.info(`Skipped ${summary.skipped} games`);
  log.info(`Collection completed in ${summary.durationSec} seconds (status: ${summary.status})`, summary.httpStats);
  return summary;
}

module.exports = { runScrape, discoverUniverses };
