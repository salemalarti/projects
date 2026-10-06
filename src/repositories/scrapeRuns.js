const { toInt } = require('../db');

async function startRun(db) {
  const { rows } = await db.query(`INSERT INTO scrape_runs (status) VALUES ('running') RETURNING id`);
  return toInt(rows[0].id);
}

async function finishRun(db, id, { status, found, stored, skipped, errorSummary = null }) {
  await db.query(
    `UPDATE scrape_runs SET finished_at = now(), status = $2, games_found = $3, games_stored = $4,
            games_skipped = $5, error_summary = $6 WHERE id = $1`,
    [id, status, found, stored, skipped, errorSummary ? String(errorSummary).slice(0, 2000) : null],
  );
}

// Time of the most recent run that stored data ("Data updated at").
async function lastSuccessfulRun(db) {
  const { rows } = await db.query(
    `SELECT finished_at, status, games_stored FROM scrape_runs
      WHERE status IN ('success', 'partial') AND games_stored > 0
      ORDER BY finished_at DESC LIMIT 1`,
  );
  if (!rows[0]) return null;
  return { finishedAt: new Date(rows[0].finished_at).toISOString(), status: rows[0].status, gamesStored: toInt(rows[0].games_stored) };
}

module.exports = { startRun, finishRun, lastSuccessfulRun };
