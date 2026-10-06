// Trend calculation from historical snapshots. Pure functions, no I/O.
//
// Method (documented in README "How trends are calculated"):
//   1. "Visit velocity" = visits gained per day between two snapshots.
//   2. Compare velocity over the most recent 7 days with the 7 days before.
//   3. growth >= +threshold  -> "up"
//      growth <= -threshold  -> "down"
//      otherwise             -> "stable"
//   4. Fewer than 14 days of history (or gaps) -> "insufficient_data".
// Visit velocity is used instead of concurrent players because total visits
// do not swing with time-of-day, so it is a steadier signal.

const DAY_MS = 24 * 3600 * 1000;

function toPoints(snapshots) {
  return snapshots
    .map((s) => ({
      t: new Date(s.capturedAt).getTime(),
      visits: s.visits === null ? null : Number(s.visits),
      concurrent: s.concurrentPlayers === null ? null : Number(s.concurrentPlayers),
    }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

// Snapshot closest to `target`, if one is within `toleranceDays`.
function pointNear(points, target, toleranceDays) {
  let best = null;
  for (const p of points) {
    const d = Math.abs(p.t - target);
    if (d <= toleranceDays * DAY_MS && (!best || d < Math.abs(best.t - target))) best = p;
  }
  return best;
}

// Average visits gained per day across the window ending at `end`.
function visitVelocity(points, end, days, toleranceDays) {
  const a = pointNear(points, end - days * DAY_MS, toleranceDays);
  const b = pointNear(points, end, toleranceDays);
  if (!a || !b || a === b || a.visits === null || b.visits === null) return null;
  const spanDays = (b.t - a.t) / DAY_MS;
  // Require the measured span to be close to the intended window.
  if (spanDays < days * 0.75) return null;
  const gained = b.visits - a.visits;
  if (gained < 0) return null; // bad data; never report negative visit gains
  return gained / spanDays;
}

function pctChange(current, previous) {
  if (current === null || previous === null || !(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

function classify(growthPct, thresholdPct) {
  if (growthPct === null || !Number.isFinite(growthPct)) return 'insufficient_data';
  if (growthPct >= thresholdPct) return 'up';
  if (growthPct <= -thresholdPct) return 'down';
  return 'stable';
}

function round(v, digits = 2) {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function computeGameTrend(snapshots, { thresholdPct = 10 } = {}) {
  const points = toPoints(snapshots);
  const result = {
    snapshotCount: points.length,
    firstCapturedAt: points.length ? new Date(points[0].t).toISOString() : null,
    latestCapturedAt: points.length ? new Date(points[points.length - 1].t).toISOString() : null,
    visitsPerDay7d: null,
    visitsGrowth7dPct: null,
    visitsGrowth30dPct: null,
    concurrentChange7dPct: null,
    trend: 'insufficient_data',
  };
  if (points.length < 2) return result;
  const latest = points[points.length - 1];

  const recent7 = visitVelocity(points, latest.t, 7, 1.5);
  const prior7 = visitVelocity(points, latest.t - 7 * DAY_MS, 7, 1.5);
  result.visitsPerDay7d = round(recent7, 0);
  result.visitsGrowth7dPct = round(pctChange(recent7, prior7));

  const recent30 = visitVelocity(points, latest.t, 30, 3);
  const prior30 = visitVelocity(points, latest.t - 30 * DAY_MS, 30, 3);
  result.visitsGrowth30dPct = round(pctChange(recent30, prior30));

  const weekAgo = pointNear(points, latest.t - 7 * DAY_MS, 1.5);
  if (weekAgo && weekAgo !== latest) {
    result.concurrentChange7dPct = round(pctChange(latest.concurrent, weekAgo.concurrent));
  }

  result.trend = classify(result.visitsGrowth7dPct, thresholdPct);
  return result;
}

module.exports = { computeGameTrend, classify, visitVelocity, pctChange, DAY_MS };
