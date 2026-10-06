// Centralized configuration. Every environment variable the app reads is
// listed here, with a safe default where one makes sense.
require('dotenv').config({ quiet: true });

function int(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Environment variable ${name} must be a number between ${min} and ${max} (got "${raw}")`);
  }
  return Math.floor(n);
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int('PORT', 5000, { min: 1, max: 65535 }),
  baseUrl: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL || '',
  // Extra origins allowed to call the API from a browser (comma-separated).
  corsOrigins: list('CORS_ORIGINS', []),

  roblox: {
    requestDelayMs: int('ROBLOX_REQUEST_DELAY_MS', 250, { min: 0, max: 60000 }),
    maxRetries: int('ROBLOX_MAX_RETRIES', 3, { min: 0, max: 10 }),
    timeoutMs: int('ROBLOX_TIMEOUT_MS', 15000, { min: 1000, max: 120000 }),
    maxConsecutiveFailures: int('ROBLOX_MAX_CONSECUTIVE_FAILURES', 5, { min: 1, max: 100 }),
    maxGames: int('ROBLOX_MAX_GAMES', 300, { min: 1, max: 5000 }),
    // Roblox Charts sorts used to discover games. Unknown sorts are skipped.
    sortIds: list('ROBLOX_SORT_IDS', ['top-playing-now', 'top-trending', 'up-and-coming', 'top-revisited']),
    // Optional extra universe IDs to always track (comma-separated).
    extraUniverseIds: list('ROBLOX_EXTRA_UNIVERSE_IDS', []),
    // Base URLs are overridable only so tests can point at a local mock server.
    gamesApiBase: process.env.ROBLOX_GAMES_API_BASE || 'https://games.roblox.com',
    exploreApiBase: process.env.ROBLOX_EXPLORE_API_BASE || 'https://apis.roblox.com',
  },

  trends: {
    thresholdPct: int('TREND_THRESHOLD_PCT', 10, { min: 1, max: 100 }),
    staleAfterDays: int('STALE_AFTER_DAYS', 3, { min: 1, max: 365 }),
  },

  email: {
    provider: (process.env.EMAIL_PROVIDER || 'none').toLowerCase(),
    apiKey: process.env.EMAIL_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
  },
};

config.isProduction = config.env === 'production';
config.email.enabled = config.email.provider === 'resend' && !!config.email.apiKey && !!config.email.from;

module.exports = config;
