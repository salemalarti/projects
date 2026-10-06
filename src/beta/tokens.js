// Secure random tokens. The raw token is only ever sent to the user (in an
// email link); the database stores a SHA-256 hash, so a database leak does
// not leak working access links. Tokens contain no personal information.
const crypto = require('crypto');

const generateToken = () => crypto.randomBytes(32).toString('base64url'); // 256 bits
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const looksLikeToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

module.exports = { generateToken, hashToken, looksLikeToken };
