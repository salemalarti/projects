// Verifies a beta access token sent as "Authorization: Bearer <token>".
// Tokens travel in a header (not the URL) so they don't end up in server logs.
const { getDb } = require('../db');
const signups = require('../repositories/signups');
const { hashToken, looksLikeToken } = require('../beta/tokens');
const { HttpError } = require('./errors');

function readToken(req) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

async function lookupAccess(req) {
  const token = readToken(req);
  if (!token || !looksLikeToken(token)) return null;
  return signups.findByAccessHash(await getDb(), hashToken(token));
}

function requireBetaAccess(req, res, next) {
  lookupAccess(req)
    .then((user) => {
      if (!user) return next(new HttpError(401, 'Beta access required. Use the link from your signup email.'));
      req.betaUser = user;
      return next();
    })
    .catch(next);
}

module.exports = { requireBetaAccess, lookupAccess };
