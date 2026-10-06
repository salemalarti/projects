// Turns raw Roblox API objects into our internal game shape.
// Only fields Roblox actually returns are filled; anything else is null.

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : NaN; // NaN fails validation
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function cleanGenre(v) {
  const t = cleanText(v, 100);
  // Roblox uses "All" / "Unknown" to mean "no genre set".
  return t && !['all', 'unknown', 'none'].includes(t.toLowerCase()) ? t : null;
}

function isoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : String(v); // invalid -> fails validation
}

// details: one item from games.roblox.com/v1/games `data`
// votes: one item from games.roblox.com/v1/games/votes `data` (optional)
// sorts: chart sort IDs this game appeared in during this run
function normalizeGame(details, votes = null, sorts = []) {
  return {
    universeId: toNumberOrNull(details.id),
    rootPlaceId: toNumberOrNull(details.rootPlaceId),
    name: cleanText(details.name, 1000),
    description: cleanText(details.description, 4000),
    genre: cleanGenre(details.genre),
    genreL1: cleanGenre(details.genre_l1),
    genreL2: cleanGenre(details.genre_l2),
    creatorName: cleanText(details.creator && details.creator.name, 200),
    creatorType: cleanText(details.creator && details.creator.type, 50),
    maxPlayers: Number.isSafeInteger(details.maxPlayers) ? details.maxPlayers : null,
    releaseDate: isoOrNull(details.created),
    robloxUpdatedAt: isoOrNull(details.updated),
    visits: toNumberOrNull(details.visits),
    concurrentPlayers: toNumberOrNull(details.playing),
    favorites: toNumberOrNull(details.favoritedCount),
    upVotes: votes ? toNumberOrNull(votes.upVotes) : null,
    downVotes: votes ? toNumberOrNull(votes.downVotes) : null,
    sourceSorts: [...new Set(sorts)].sort(),
  };
}

// Picks the best genre label to show users.
function displayGenre(game) {
  return game.genreL1 || game.genre || null;
}

module.exports = { normalizeGame, displayGenre, toNumberOrNull };
