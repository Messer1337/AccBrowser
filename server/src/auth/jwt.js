const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
    throw new Error('JWT_SECRET env var is required and must be at least 16 characters.');
}

// 24h TTL, no refresh tokens: the Electron client already disables session persistence
// and re-prompts for a password on every app launch, so a 24h token needs no refresh
// machinery. Role/allowedProfiles are never embedded in the token — every request
// re-reads the users table (see auth/middleware.js), so a revoke takes effect on the
// very next call, not at token expiry.
function sign(username) {
    return jwt.sign({ sub: username }, SECRET, { expiresIn: '24h' });
}

function verify(token) {
    try {
        const decoded = jwt.verify(token, SECRET);
        return decoded.sub;
    } catch (e) {
        return null;
    }
}

module.exports = { sign, verify };
