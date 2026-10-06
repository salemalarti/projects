const express = require('express');
const config = require('../config');
const logger = require('../logger');
const { getDb } = require('../db');
const signups = require('../repositories/signups');
const events = require('../repositories/events');
const { generateToken, hashToken, looksLikeToken } = require('../beta/tokens');
const { confirmationEmail } = require('../email/templates');
const { createEmailSender } = require('../email/provider');
const { asyncHandler, HttpError } = require('../middleware/errors');
const { validateSignup } = require('../middleware/validate');
const { lookupAccess } = require('../middleware/betaAccess');

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

function createBetaRouter({ emailSender = createEmailSender(), baseUrl = config.baseUrl } = {}) {
  const router = express.Router();

  const confirmUrlFor = (token) => `${baseUrl}/api/beta/confirm?token=${encodeURIComponent(token)}`;
  const dashboardUrlFor = (accessToken) => `${baseUrl}/dashboard#access=${encodeURIComponent(accessToken)}`;

  // New tokens for an existing signup (old links stop working).
  async function rotateTokens(db, row) {
    const confirmationToken = generateToken();
    const accessToken = generateToken();
    await signups.rotateTokens(db, row.id, {
      confirmationTokenHash: hashToken(confirmationToken),
      accessTokenHash: hashToken(accessToken),
    });
    return { confirmationToken, accessToken };
  }

  router.post('/beta-signups', asyncHandler(async (req, res) => {
    const input = validateSignup(req.body);
    if (input.isBot) {
      // Pretend success so bots learn nothing; store nothing.
      return res.status(201).json({ status: 'created', message: "You're on the list!" });
    }
    const db = await getDb();

    const confirmationToken = generateToken();
    const accessToken = generateToken();
    const { row, created } = await signups.createSignup(db, {
      ...input,
      confirmationTokenHash: hashToken(confirmationToken),
      accessTokenHash: hashToken(accessToken),
    });

    let tokens = { confirmationToken, accessToken };
    if (!created) {
      // Duplicate email: no second row. Re-send a fresh link, at most every 10 minutes.
      const lastSent = row.last_email_sent_at ? new Date(row.last_email_sent_at).getTime() : 0;
      if (emailSender.enabled && Date.now() - lastSent < RESEND_COOLDOWN_MS) {
        return res.status(200).json({
          status: 'already_registered',
          emailSent: false,
          message: "You're already on the beta list. We emailed your link a few minutes ago - check your inbox (and spam folder).",
        });
      }
      tokens = await rotateTokens(db, row);
    }

    const email = confirmationEmail({ name: row.name, confirmUrl: confirmUrlFor(tokens.confirmationToken) });
    const result = await emailSender.send({ to: row.email, ...email });
    if (result.sent) await signups.markEmailSent(db, row.id);
    events.recordEvent(db, { name: 'signup_succeeded', path: '/api/beta-signups', props: { created, emailSent: result.sent } })
      .catch((err) => logger.warn('Could not record event', { reason: err.message }));

    const body = { status: created ? 'created' : 'already_registered', emailSent: result.sent };
    if (result.sent) {
      body.message = created ? "You're on the list!" : "You're already on the beta list - we've emailed you a fresh access link.";
    } else {
      // Email isn't configured (or failed). Don't pretend; give the access link
      // directly so the beta still works. Email stays unconfirmed in the database.
      body.message = (created ? "You're on the list!" : "You're already on the beta list.") +
        ' We could not send an email right now, so here is your personal access link. Bookmark it.';
      body.accessUrl = dashboardUrlFor(tokens.accessToken);
    }
    return res.status(created ? 201 : 200).json(body);
  }));

  // Link in the confirmation email. Confirms the email, then opens the dashboard.
  router.get('/beta/confirm', asyncHandler(async (req, res) => {
    const token = req.query.token;
    if (!looksLikeToken(token)) return res.redirect(302, '/dashboard#error=invalid_link');
    const db = await getDb();
    const confirmed = await signups.confirmByTokenHash(db, hashToken(token));
    if (!confirmed) return res.redirect(302, '/dashboard#error=expired_link');
    // Issue a fresh access token now (the old one was never shown to the user).
    const accessToken = generateToken();
    await db.query('UPDATE beta_signups SET access_token_hash = $2, updated_at = now() WHERE id = $1', [confirmed.id, hashToken(accessToken)]);
    // Fragment (#) is never sent to servers, so the token stays out of logs.
    return res.redirect(302, `/dashboard#access=${encodeURIComponent(accessToken)}&confirmed=1`);
  }));

  // Dashboard calls this with "Authorization: Bearer <token>".
  router.get('/beta/access', asyncHandler(async (req, res) => {
    const user = await lookupAccess(req);
    if (!user) throw new HttpError(401, 'This access link is not valid. Sign up again on the home page to get a new one.');
    res.json({ valid: true, name: user.name, emailConfirmed: user.emailConfirmed });
  }));

  return router;
}

module.exports = { createBetaRouter };
