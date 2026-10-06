// Roblox data provider. This is the ONLY module that knows Roblox URLs.
// If Roblox changes or retires an endpoint, only this file needs to change.
//
// Endpoints used (all public, no API key or login):
//   Discovery (undocumented, used by the roblox.com Charts page):
//     GET https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=&sortId=
//     GET https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=   (fallback)
//   Details (documented legacy web API):
//     GET https://games.roblox.com/v1/games?universeIds=1,2,3
//     GET https://games.roblox.com/v1/games/votes?universeIds=1,2,3
const crypto = require('crypto');

const DETAILS_BATCH_SIZE = 50;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Pulls game entries out of either a single sort or a list of sorts,
// tolerating small shape changes.
function extractChartGames(json, fallbackSortId) {
  if (!json || typeof json !== 'object') return [];
  const sorts = Array.isArray(json.sorts) ? json.sorts : [json];
  const games = [];
  for (const sort of sorts) {
    if (!sort || !Array.isArray(sort.games)) continue;
    if (sort.contentType && sort.contentType !== 'Games') continue;
    const sortId = sort.sortId || fallbackSortId || 'unknown';
    for (const g of sort.games) games.push({ ...g, _sortId: sortId });
  }
  return games;
}

function createRobloxProvider({ http, gamesApiBase, exploreApiBase }) {
  const sessionId = crypto.randomUUID();

  async function getChartSort(sortId) {
    const url = `${exploreApiBase}/explore-api/v1/get-sort-content?sessionId=${sessionId}&sortId=${encodeURIComponent(sortId)}`;
    return extractChartGames(await http.getJson(url), sortId);
  }

  async function getAllChartSorts() {
    const url = `${exploreApiBase}/explore-api/v1/get-sorts?sessionId=${sessionId}`;
    return extractChartGames(await http.getJson(url));
  }

  async function getGameDetails(universeIds) {
    const out = [];
    for (const ids of chunk(universeIds, DETAILS_BATCH_SIZE)) {
      const json = await http.getJson(`${gamesApiBase}/v1/games?universeIds=${ids.join(',')}`);
      if (!json || !Array.isArray(json.data)) {
        throw new Error('Unexpected response from games API: missing "data" array');
      }
      out.push(...json.data);
    }
    return out;
  }

  async function getGameVotes(universeIds) {
    const out = [];
    for (const ids of chunk(universeIds, DETAILS_BATCH_SIZE)) {
      const json = await http.getJson(`${gamesApiBase}/v1/games/votes?universeIds=${ids.join(',')}`);
      if (json && Array.isArray(json.data)) out.push(...json.data);
    }
    return out;
  }

  return { getChartSort, getAllChartSorts, getGameDetails, getGameVotes };
}

module.exports = { createRobloxProvider, extractChartGames, chunk, DETAILS_BATCH_SIZE };
