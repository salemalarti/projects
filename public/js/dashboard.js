(function () {
  const { getJson, track, escapeHtml: esc, compact, formatUtc, storage } = window.RA;
  const $ = (id) => document.getElementById(id);
  const PAGE = 25;
  const state = { sort: 'playing', genre: '', offset: 0, accessToken: null, betaUser: null };

  const TREND_LABEL = {
    up: '↑ Growing',
    stable: '→ Stable',
    down: '↓ Declining',
    insufficient_data: '… Not enough history',
  };

  const loading = (rows) => Array.from({ length: rows || 5 }, () => '<div class="skeleton"></div>').join('');
  const errorState = (msg) => '<p class="state error">⚠️ ' + esc(msg) + '</p>';
  const pct = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
  const trendChip = (g) => '<span class="trend ' + g.trend + '">' + TREND_LABEL[g.trend] + '</span>';
  const genreLine = (g) => esc(g.genre || 'No genre set') + (g.subgenre ? ' · ' + esc(g.subgenre) : '');

  // ---------------------------------------------------------------- beta access
  async function initBetaAccess() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const banner = $('beta-banner');
    if (hash.get('access')) storage('set', 'ra_access', hash.get('access'));
    if (location.hash) history.replaceState(null, '', location.pathname + location.search); // remove token from the address bar
    if (hash.get('error')) {
      banner.innerHTML = '<div class="banner error">That link is invalid or has expired. <a href="/#signup">Sign up again with the same email</a> to get a fresh link.</div>';
    }
    state.accessToken = storage('get', 'ra_access');
    if (!state.accessToken) {
      if (!hash.get('error')) banner.innerHTML = '<div class="banner">You\'re viewing the free dashboard. <a href="/#signup">Join the free beta</a> to unlock each game\'s full history.</div>';
      return;
    }
    try {
      const res = await getJson('/beta/access', { headers: { Authorization: 'Bearer ' + state.accessToken } });
      state.betaUser = res;
      banner.innerHTML = '<div class="banner">✅ Beta access active' + (res.name ? ' — welcome, ' + esc(res.name) : '') +
        (hash.get('confirmed') ? '. Your email is confirmed.' : '.') + ' Click any game to see its history.</div>';
      if (hash.get('access')) track('beta_access_granted', { confirmed: !!hash.get('confirmed') });
    } catch (err) {
      if (err.status === 401) {
        storage('remove', 'ra_access');
        state.accessToken = null;
        banner.innerHTML = '<div class="banner error">Your beta link is no longer valid (a newer link may have been sent). <a href="/#signup">Get a new link</a>.</div>';
      }
    }
  }

  // ---------------------------------------------------------------- freshness
  function showFreshness(meta) {
    const el = $('freshness');
    if (!meta || !meta.dataUpdatedAt) {
      el.textContent = 'No data has been collected yet. Run "npm run scrape" (see SETUP.md).';
      el.className = 'freshness stale';
      return;
    }
    const ageDays = (Date.now() - new Date(meta.dataUpdatedAt).getTime()) / 86400000;
    el.innerHTML = '<strong>Data updated:</strong> ' + esc(formatUtc(meta.dataUpdatedAt)) +
      (ageDays > meta.staleAfterDays ? ' — ⚠️ this data is more than ' + meta.staleAfterDays + ' days old' : '');
    el.className = 'freshness' + (ageDays > meta.staleAfterDays ? ' stale' : '');
  }

  // ---------------------------------------------------------------- KPIs + trends
  async function loadTrends() {
    $('rising').innerHTML = loading(4);
    try {
      const [trends, status] = await Promise.all([getJson('/trends?limit=8'), getJson('/status')]);
      const c = trends.data.counts;
      const tracked = c.up + c.stable + c.down + c.insufficient_data;
      $('kpis').innerHTML = [
        [compact(tracked), 'Games with fresh data'],
        [c.up, '↑ Growing'],
        [c.stable, '→ Stable'],
        [c.down, '↓ Declining'],
        [c.insufficient_data, 'Not enough history yet'],
        [compact(status.data.snapshots), 'Daily snapshots stored'],
      ].map(([v, l]) => '<div class="kpi"><div class="kpi-value">' + esc(v) + '</div><div class="kpi-label">' + esc(l) + '</div></div>').join('');

      $('trend-note').textContent = 'Visits gained per day, last 7 days vs. the 7 days before. "Growing" means ≥ +' +
        trends.meta.thresholdPct + '%, "Declining" ≤ −' + trends.meta.thresholdPct + '%.';
      const rising = trends.data.rising;
      if (!rising.length) {
        $('rising').innerHTML = '<p class="state">' + (c.insufficient_data && !c.up && !c.stable && !c.down
          ? 'Trends need ' + trends.meta.minimumHistoryDays + ' days of daily snapshots. We\'re building that history now — check back soon. We won\'t guess before then.'
          : 'No game crossed the growth threshold this week.') + '</p>';
        return;
      }
      $('rising').innerHTML = rising.map((g) =>
        '<div class="list-item clickable" data-id="' + g.universeId + '" tabindex="0" role="button">' +
          '<div><div class="game-name">' + esc(g.name) + '</div><div class="game-genre">' + genreLine(g) + '</div></div>' +
          '<div style="text-align:right"><span class="trend up">' + pct(g.visitsGrowth7dPct) + '</span>' +
          '<div class="game-genre">' + compact(g.visitsPerDay7d) + ' visits/day</div></div></div>').join('');
    } catch (err) {
      $('rising').innerHTML = errorState('Could not load trends: ' + err.message);
      $('kpis').innerHTML = '';
    }
  }

  async function loadGenres() {
    $('genres').innerHTML = loading(5);
    try {
      const res = await getJson('/genres');
      const select = $('genre');
      res.data.forEach((g) => {
        if (g.genre === 'Unclassified') return;
        const o = document.createElement('option');
        o.value = g.genre; o.textContent = g.genre + ' (' + g.games + ')';
        select.appendChild(o);
      });
      if (!res.data.length) { $('genres').innerHTML = '<p class="state">No genre data yet.</p>'; return; }
      $('genres').innerHTML = '<div class="table-wrap"><table><thead><tr><th>Genre</th><th class="num">Games</th><th class="num">Players now</th><th class="num">↑ / ↓</th></tr></thead><tbody>' +
        res.data.map((g) => '<tr><td>' + esc(g.genre) + '</td><td class="num">' + g.games + '</td><td class="num">' + compact(g.concurrentPlayers) +
          '</td><td class="num">' + (g.gamesWithGrowthData ? g.rising + ' / ' + g.falling : '<span title="Not enough history yet">—</span>') + '</td></tr>').join('') +
        '</tbody></table></div>';
    } catch (err) {
      $('genres').innerHTML = errorState('Could not load genres: ' + err.message);
    }
  }

  // ---------------------------------------------------------------- games table
  async function loadGames(append) {
    const box = $('games');
    if (!append) { state.offset = 0; box.innerHTML = loading(8); }
    const q = new URLSearchParams({ sort: state.sort, limit: PAGE, offset: state.offset });
    if (state.genre) q.set('genre', state.genre);
    try {
      const res = await getJson('/games?' + q);
      showFreshness(res.meta);
      if (!append && !res.data.length) {
        box.innerHTML = '<p class="state">No games yet. Data appears after the first collection run.</p>';
        return;
      }
      const rows = res.data.map((g, i) =>
        '<tr class="clickable" data-id="' + g.universeId + '" tabindex="0">' +
          '<td class="rank">' + (state.offset + i + 1) + '</td>' +
          '<td><div class="game-name">' + esc(g.name) + '</div><div class="game-genre">' + genreLine(g) + '</div></td>' +
          '<td class="num">' + compact(g.concurrentPlayers) + '</td>' +
          '<td class="num hide-mobile">' + compact(g.visits) + '</td>' +
          '<td class="num">' + trendChip(g) + (g.visitsGrowth7dPct !== null ? '<div class="game-genre">' + pct(g.visitsGrowth7dPct) + '</div>' : '') + '</td>' +
        '</tr>').join('');
      if (!append) {
        box.innerHTML = '<div class="table-wrap"><table><thead><tr><th></th><th>Game</th><th class="num">Players now</th><th class="num hide-mobile">Visits</th><th class="num">Trend (7d)</th></tr></thead><tbody id="games-body"></tbody></table></div>' +
          '<button class="more-btn" id="more">Show more</button>';
        $('more').addEventListener('click', () => { state.offset += PAGE; loadGames(true); });
      }
      $('games-body').insertAdjacentHTML('beforeend', rows);
      const shown = state.offset + res.data.length;
      $('more').hidden = shown >= res.meta.total;
    } catch (err) {
      if (append) { state.offset -= PAGE; alert('Could not load more games: ' + err.message); return; }
      box.innerHTML = errorState('Could not load games: ' + err.message);
      $('freshness').textContent = 'Data unavailable right now.';
      $('freshness').className = 'freshness stale';
    }
  }

  // ---------------------------------------------------------------- game detail
  function fact(label, value, na) {
    return '<div class="fact"><div class="fact-label">' + esc(label) + '</div><div class="fact-value' + (na ? ' na' : '') + '">' + esc(value) + '</div></div>';
  }

  async function openGame(id) {
    const panel = $('detail');
    panel.classList.add('open');
    panel.innerHTML = loading(6);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const { data: g } = await getJson('/games/' + id);
      const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
      panel.innerHTML =
        '<div class="detail-head"><div><h2>' + esc(g.name) + '</h2><p class="card-note">' + genreLine(g) +
          (g.creator ? ' · by ' + esc(g.creator.name) : '') + ' · Data captured ' + esc(formatUtc(g.dataCapturedAt) || '—') + '</p></div>' +
          '<div>' + (g.robloxUrl ? '<a class="close-btn" style="text-decoration:none;color:#333" href="' + esc(g.robloxUrl) + '" target="_blank" rel="noopener">View on Roblox ↗</a> ' : '') +
          '<button class="close-btn" id="close-detail">Close</button></div></div>' +
        '<div class="facts">' +
          fact('Players right now', compact(g.concurrentPlayers)) +
          fact('Total visits', compact(g.visits)) +
          fact('Favorites', compact(g.favorites)) +
          fact('Likes', g.likeRatioPct === null ? 'Not available' : g.likeRatioPct + '% positive', g.likeRatioPct === null) +
          fact('Released', date(g.releaseDate)) +
          fact('Last updated by creator', date(g.lastPublishedAt)) +
          fact('Trend (7 days)', TREND_LABEL[g.trend] + (g.visitsGrowth7dPct !== null ? ' ' + pct(g.visitsGrowth7dPct) : '')) +
          fact('Visits per day (7d avg)', g.visitsPerDay7d === null ? 'Not enough history yet' : compact(g.visitsPerDay7d), g.visitsPerDay7d === null) +
          fact('Visit growth (30 days)', g.visitsGrowth30dPct === null ? 'Not enough history yet' : pct(g.visitsGrowth30dPct), g.visitsGrowth30dPct === null) +
          fact('Player retention', 'Not publicly available', true) +
          fact('Avg. session length', 'Not publicly available', true) +
          fact('Monetization / revenue', 'Not publicly available', true) +
        '</div><div id="history"></div>';
      $('close-detail').addEventListener('click', () => { panel.classList.remove('open'); panel.innerHTML = ''; });
      loadHistory(g);
    } catch (err) {
      panel.innerHTML = errorState('Could not load this game: ' + err.message);
    }
  }

  async function loadHistory(g) {
    const box = $('history');
    if (!state.accessToken) {
      box.innerHTML = '<div class="banner">📈 Player and visit history for every game is a beta feature. <a href="/#signup">Join the free beta</a> to unlock it.</div>';
      return;
    }
    box.innerHTML = loading(3);
    try {
      const res = await getJson('/games/' + g.universeId + '/history?days=90', { headers: { Authorization: 'Bearer ' + state.accessToken } });
      track('game_history_view');
      const snaps = res.data;
      if (!snaps.length) { box.innerHTML = '<p class="state">No history yet.</p>'; return; }
      // Visits gained per day between consecutive snapshots (only when the gap is 1-2 days).
      const perDay = [];
      for (let i = 1; i < snaps.length; i += 1) {
        const days = (new Date(snaps[i].capturedAt) - new Date(snaps[i - 1].capturedAt)) / 86400000;
        const gained = snaps[i].visits - snaps[i - 1].visits;
        if (days >= 0.5 && days <= 2.5 && gained >= 0) perDay.push({ x: new Date(snaps[i].capturedAt), y: gained / days });
      }
      box.innerHTML =
        '<div class="charts">' +
          '<div><div class="chart-title">Players at time of daily snapshot</div><div id="chart-ccu"></div></div>' +
          '<div><div class="chart-title">Visits gained per day</div><div id="chart-visits"></div></div>' +
        '</div>' +
        '<details><summary>Show data table (' + snaps.length + ' days)</summary><div class="table-wrap history-table"><table><thead><tr><th>Date (UTC)</th><th class="num">Players</th><th class="num">Total visits</th><th class="num">Favorites</th></tr></thead><tbody>' +
          snaps.slice().reverse().map((s) => '<tr><td>' + esc(s.date) + '</td><td class="num">' + s.concurrentPlayers.toLocaleString() + '</td><td class="num">' + s.visits.toLocaleString() +
            '</td><td class="num">' + (s.favorites === null ? '—' : s.favorites.toLocaleString()) + '</td></tr>').join('') +
        '</tbody></table></div></details>' +
        '<p class="card-note" style="margin-top:10px">Snapshots are taken once a day, so player counts reflect that moment, not a daily average.</p>';
      window.RAChart.line($('chart-ccu'), snaps.map((s) => ({ x: new Date(s.capturedAt), y: s.concurrentPlayers })), { label: 'Players over time', format: (v) => Math.round(v).toLocaleString() + ' players' });
      window.RAChart.line($('chart-visits'), perDay, { label: 'Visits gained per day', format: (v) => Math.round(v).toLocaleString() + ' visits' });
    } catch (err) {
      box.innerHTML = err.status === 401
        ? '<div class="banner error">Your beta link is no longer valid. <a href="/#signup">Get a new link</a>.</div>'
        : errorState('Could not load history: ' + err.message);
    }
  }

  // ---------------------------------------------------------------- wiring
  function onActivate(container, handler) {
    container.addEventListener('click', (e) => { const row = e.target.closest('[data-id]'); if (row) handler(row.dataset.id); });
    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('[data-id]');
      if (row) { e.preventDefault(); handler(row.dataset.id); }
    });
  }

  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; track('sort_changed', { sort: state.sort }); loadGames(); });
  $('genre').addEventListener('change', (e) => { state.genre = e.target.value; track('genre_filter_used'); loadGames(); });
  onActivate($('games'), openGame);
  onActivate($('rising'), openGame);

  initBetaAccess().finally(() => track('dashboard_view', { beta: !!state.betaUser }));
  loadGames();
  loadTrends();
  loadGenres();
})();
