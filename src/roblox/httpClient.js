// Polite HTTP client for Roblox's public web endpoints.
// - spaces requests (ROBLOX_REQUEST_DELAY_MS) per host
// - retries 429 / 5xx / network errors with exponential backoff + jitter
// - honors Retry-After
// - stops entirely after too many consecutive failures (circuit breaker)
// It never tries to bypass Roblox security controls (no cookies, no captchas,
// no rotating proxies or spoofed identities).
const logger = require('../logger');

class RobloxHttpError extends Error {
  constructor(message, { status = null, url = null, retryable = false } = {}) {
    super(message);
    this.name = 'RobloxHttpError';
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

class CircuitOpenError extends Error {
  constructor(failures) {
    super(`Stopped calling Roblox after ${failures} consecutive failed requests`);
    this.name = 'CircuitOpenError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseRetryAfter(header) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function createHttpClient({
  requestDelayMs = 250,
  maxRetries = 3,
  timeoutMs = 15000,
  maxConsecutiveFailures = 5,
  baseBackoffMs = 1000,
  maxBackoffMs = 60000,
  userAgent = 'RobloxAnalyticsMVP/1.1',
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
} = {}) {
  const lastRequestAt = new Map(); // host -> timestamp
  const stats = { requests: 0, retries: 0, rateLimited: 0, failures: 0 };
  let consecutiveFailures = 0;

  async function waitTurn(host) {
    const last = lastRequestAt.get(host) || 0;
    const wait = last + requestDelayMs - Date.now();
    if (wait > 0) await sleepImpl(wait);
    lastRequestAt.set(host, Date.now());
  }

  async function attempt(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      stats.requests += 1;
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
        signal: controller.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        if (res.status === 429) {
          stats.rateLimited += 1;
          logger.warn('Roblox rate limit hit (HTTP 429)', { url, retryAfter: res.headers.get('retry-after') });
        }
        const err = new RobloxHttpError(`HTTP ${res.status}`, { status: res.status, url, retryable: true });
        err.retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        throw err;
      }
      if (!res.ok) throw new RobloxHttpError(`HTTP ${res.status}`, { status: res.status, url, retryable: false });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new RobloxHttpError('Response was not valid JSON', { status: res.status, url, retryable: false });
      }
    } catch (err) {
      if (err instanceof RobloxHttpError) throw err;
      const reason = err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message;
      throw new RobloxHttpError(`Network error: ${reason}`, { url, retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJson(url) {
    if (consecutiveFailures >= maxConsecutiveFailures) throw new CircuitOpenError(consecutiveFailures);
    const host = new URL(url).host;
    for (let tryNo = 0; ; tryNo += 1) {
      await waitTurn(host);
      try {
        const json = await attempt(url);
        consecutiveFailures = 0;
        return json;
      } catch (err) {
        if (!err.retryable || tryNo >= maxRetries) {
          consecutiveFailures += 1;
          stats.failures += 1;
          throw err;
        }
        stats.retries += 1;
        const backoff = Math.min(maxBackoffMs, baseBackoffMs * 2 ** tryNo);
        const jitter = Math.random() * baseBackoffMs * 0.5;
        const delay = Math.min(maxBackoffMs, Math.max(err.retryAfterMs || 0, backoff + jitter));
        logger.warn(`Retrying Roblox request in ${Math.round(delay)}ms (attempt ${tryNo + 2}/${maxRetries + 1})`, {
          url,
          reason: err.message,
        });
        await sleepImpl(delay);
      }
    }
  }

  return { getJson, stats, isOpen: () => consecutiveFailures >= maxConsecutiveFailures };
}

module.exports = { createHttpClient, RobloxHttpError, CircuitOpenError, parseRetryAfter };
