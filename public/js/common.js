// Shared browser helpers (no secrets here: this file is public).
(function () {
  const API = '/api';

  function safeStorage(op, key, value) {
    try {
      if (op === 'get') return window.localStorage.getItem(key);
      if (op === 'set') window.localStorage.setItem(key, value);
      if (op === 'remove') window.localStorage.removeItem(key);
    } catch (e) { /* storage blocked: app still works, just forgets */ }
    return null;
  }

  function sessionId() {
    let id = safeStorage('get', 'ra_session');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
      safeStorage('set', 'ra_session', id);
    }
    return id;
  }

  // Fire-and-forget anonymous analytics event.
  function track(name, props) {
    try {
      fetch(API + '/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path: location.pathname, sessionId: sessionId(), props: props || {} }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  async function getJson(path, opts) {
    const res = await fetch(API + path, opts);
    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function compact(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 1 : 2).replace(/\.0+$/, '') + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }

  function formatUtc(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';
  }

  window.RA = { getJson, track, escapeHtml, compact, formatUtc, storage: safeStorage };
})();
