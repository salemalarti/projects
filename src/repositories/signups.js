const { toInt } = require('../db');

const CONFIRMATION_TTL_HOURS = 72;

async function findByEmail(db, email) {
  const { rows } = await db.query('SELECT * FROM beta_signups WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
}

// Returns { row, created } and never creates a duplicate (unique index on lower(email)).
async function createSignup(db, s) {
  const { rows } = await db.query(
    `INSERT INTO beta_signups (name, email, roblox_username, game_experience, interest, source,
                               confirmation_token_hash, confirmation_expires_at, access_token_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(hours => $8), $9)
     ON CONFLICT ((lower(email))) DO NOTHING
     RETURNING *`,
    [s.name, s.email, s.robloxUsername, s.gameExperience, s.interest, s.source,
      s.confirmationTokenHash, CONFIRMATION_TTL_HOURS, s.accessTokenHash],
  );
  if (rows[0]) return { row: rows[0], created: true };
  return { row: await findByEmail(db, s.email), created: false };
}

// Issues fresh tokens for an existing signup (e.g. they lost the email).
async function rotateTokens(db, id, { confirmationTokenHash, accessTokenHash }) {
  await db.query(
    `UPDATE beta_signups SET confirmation_token_hash = $2,
            confirmation_expires_at = now() + make_interval(hours => $3),
            access_token_hash = $4, updated_at = now()
      WHERE id = $1`,
    [id, confirmationTokenHash, CONFIRMATION_TTL_HOURS, accessTokenHash],
  );
}

async function markEmailSent(db, id) {
  await db.query('UPDATE beta_signups SET last_email_sent_at = now() WHERE id = $1', [id]);
}

// One-time use: the confirmation hash is cleared after use.
async function confirmByTokenHash(db, hash) {
  const { rows } = await db.query(
    `UPDATE beta_signups SET email_confirmed = true, email_confirmed_at = COALESCE(email_confirmed_at, now()),
            status = CASE WHEN status = 'disabled' THEN status ELSE 'confirmed' END,
            confirmation_token_hash = NULL, updated_at = now()
      WHERE confirmation_token_hash = $1 AND confirmation_expires_at > now()
      RETURNING id, name, status`,
    [hash],
  );
  return rows[0] || null;
}

async function findByAccessHash(db, hash) {
  const { rows } = await db.query(
    `UPDATE beta_signups SET last_access_at = now()
      WHERE access_token_hash = $1 AND status <> 'disabled'
      RETURNING id, name, email_confirmed, status`,
    [hash],
  );
  if (!rows[0]) return null;
  return { id: toInt(rows[0].id), name: rows[0].name, emailConfirmed: rows[0].email_confirmed, status: rows[0].status };
}

module.exports = { createSignup, findByEmail, rotateTokens, markEmailSent, confirmByTokenHash, findByAccessHash };
