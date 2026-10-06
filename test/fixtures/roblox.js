// TEST FIXTURES ONLY. Shaped like Roblox API responses so the pipeline can be
// tested offline. Names are deliberately fake; never used outside tests.
function sortContent(sortId, ids) {
  return {
    sortId,
    sortDisplayName: sortId,
    games: ids.map((id) => ({ universeId: id, rootPlaceId: id * 10, name: `Test Game ${id}`, playerCount: 1000, isSponsored: false })),
  };
}

function gameDetails(id, overrides = {}) {
  return {
    id,
    rootPlaceId: id * 10,
    name: `Test Game ${id}`,
    description: 'fixture',
    creator: { id: 1, name: 'Fixture Studio', type: 'Group' },
    playing: 1000 * id,
    visits: 1_000_000 * id,
    maxPlayers: 20,
    created: '2021-03-04T05:06:07.000Z',
    updated: '2026-09-01T00:00:00.000Z',
    genre: 'All',
    genre_l1: id % 2 ? 'Roleplay & Avatar Sim' : 'Action',
    genre_l2: null,
    favoritedCount: 500 * id,
    ...overrides,
  };
}

module.exports = { sortContent, gameDetails };
