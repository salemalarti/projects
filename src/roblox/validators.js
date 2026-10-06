// Data-quality rules. A record that breaks any rule is skipped and logged,
// never written to the database.

// Highest concurrent-player count ever reported for one Roblox experience is
// in the tens of millions (2025 records). Anything above this is treated as bad data.
const MAX_PLAUSIBLE_CONCURRENT = 50_000_000;
// Roughly 10x the most-visited experience; beyond this a number is surely wrong.
const MAX_PLAUSIBLE_VISITS = 1_000_000_000_000;
const ROBLOX_LAUNCH = Date.parse('2006-01-01T00:00:00Z');

function isPositiveId(v) {
  return Number.isSafeInteger(v) && v > 0;
}

function isCount(v, max) {
  return Number.isSafeInteger(v) && v >= 0 && v <= max;
}

function isValidDate(iso, now = Date.now()) {
  if (iso === null) return true;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= ROBLOX_LAUNCH && t <= now + 24 * 3600 * 1000;
}

// Returns a list of problems (empty array = valid).
function validateGame(game, now = Date.now()) {
  const problems = [];
  if (!isPositiveId(game.universeId)) problems.push(`invalid universeId: ${game.universeId}`);
  if (game.rootPlaceId !== null && !isPositiveId(game.rootPlaceId)) problems.push(`invalid rootPlaceId: ${game.rootPlaceId}`);
  if (typeof game.name !== 'string' || !game.name.trim()) problems.push('missing name');
  else if (game.name.length > 300) problems.push('name too long');
  if (!isCount(game.visits, MAX_PLAUSIBLE_VISITS)) problems.push(`implausible visits: ${game.visits}`);
  if (!isCount(game.concurrentPlayers, MAX_PLAUSIBLE_CONCURRENT)) {
    problems.push(`implausible concurrentPlayers: ${game.concurrentPlayers}`);
  }
  for (const f of ['favorites', 'upVotes', 'downVotes']) {
    if (game[f] !== null && !isCount(game[f], MAX_PLAUSIBLE_VISITS)) problems.push(`invalid ${f}: ${game[f]}`);
  }
  if (!isValidDate(game.releaseDate, now)) problems.push(`malformed releaseDate: ${game.releaseDate}`);
  if (!isValidDate(game.robloxUpdatedAt, now)) problems.push(`malformed robloxUpdatedAt: ${game.robloxUpdatedAt}`);
  return problems;
}

// Total visits only ever go up. A big drop means Roblox returned bad data
// (or a different game). Allow a tiny tolerance for Roblox-side corrections.
function checkAgainstPrevious(game, previous) {
  if (!previous || previous.visits === null) return [];
  if (game.visits < previous.visits * 0.99) {
    return [`visits dropped from ${previous.visits} to ${game.visits}`];
  }
  return [];
}

module.exports = {
  validateGame,
  checkAgainstPrevious,
  MAX_PLAUSIBLE_CONCURRENT,
  MAX_PLAUSIBLE_VISITS,
};
