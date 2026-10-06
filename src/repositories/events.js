// Lightweight anonymous product analytics.
const ALLOWED_EVENTS = new Set([
  'landing_view',
  'signup_started',
  'signup_submitted',
  'signup_succeeded',
  'signup_failed',
  'dashboard_view',
  'game_history_view',
  'genre_filter_used',
  'sort_changed',
  'beta_access_granted',
]);

async function recordEvent(db, { name, path = null, sessionId = null, props = {} }) {
  await db.query('INSERT INTO events (name, path, session_id, props) VALUES ($1,$2,$3,$4::jsonb)', [
    name, path, sessionId, JSON.stringify(props),
  ]);
}

module.exports = { recordEvent, ALLOWED_EVENTS };
