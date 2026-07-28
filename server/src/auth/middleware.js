const { verify } = require('./jwt');
const { pool } = require('../db');

async function getUserRow(username) {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return rows[0] || null;
}

// Re-reads the users table on every request rather than trusting the JWT payload — the
// same "authorization is always freshly checked" property Firestore Rules' per-request
// authorizedUsers lookup gave the Firebase path, so a revoke is instant.
async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const username = token ? verify(token) : null;
    if (!username) return res.status(401).json({ message: 'Потрібна авторизація.' });
    const user = await getUserRow(username);
    if (!user) return res.status(401).json({ message: 'Потрібна авторизація.' });
    req.user = user;
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Лише адміністратор може виконати цю дію.' });
    }
    next();
}

function hasProfileAccess(user, profileId) {
    const allowed = Array.isArray(user.allowed_profiles) ? user.allowed_profiles : [];
    return user.role === 'admin' || allowed.includes('*') || allowed.includes(profileId);
}

module.exports = { requireAuth, requireAdmin, hasProfileAccess, getUserRow };
