const { HttpError } = require('./errors');

// Same rule as the landing page form. Deliberately simple; the real check is
// whether the confirmation email arrives.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

function optionalText(value, field, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const t = value.trim();
  if (t.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return t || null;
}

function validateSignup(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Request body is required');
  const errors = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name) errors.name = 'Please enter your name';
  else if (name.length > 100) errors.name = 'Name must be at most 100 characters';
  if (!email) errors.email = 'Please enter your email';
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields', errors);
  return {
    name,
    email,
    robloxUsername: optionalText(body.robloxUsername, 'robloxUsername', 50),
    gameExperience: optionalText(body.gameExperience, 'gameExperience', 1000),
    interest: optionalText(body.interest, 'interest', 1000),
    source: optionalText(body.source, 'source', 50) || 'landing',
    // Honeypot: real users never fill this hidden field.
    isBot: typeof body.website === 'string' && body.website.trim() !== '',
  };
}

function intParam(value, { name, min, max, fallback }) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}`);
  return n;
}

function universeIdParam(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Game id must be a positive Roblox universe id');
  return n;
}

module.exports = { validateSignup, intParam, universeIdParam, EMAIL_RE };
