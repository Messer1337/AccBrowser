const express = require('express');
const { pool } = require('../db');
const { hashPassword } = require('../auth/password');
const { requireAuth, requireAdmin } = require('../auth/middleware');
const { normalizeUsername, validateRole, validatePassword, normalizeAllowedProfiles, HttpError } = require('../validators');
const backendEvents = require('../events');

const router = express.Router();
router.use(requireAuth, requireAdmin);

function toTeamUserResponse(row) {
    return {
        username: row.username,
        role: row.role,
        allowedProfiles: row.allowed_profiles,
        firebaseUid: row.username,
        mustChangePassword: row.must_change_password
    };
}

router.get('/', async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users ORDER BY username');
        res.json({ users: rows.map(toTeamUserResponse) });
    } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
    try {
        const username = normalizeUsername(req.body.username);
        const role = validateRole(req.body.role || 'user');
        const allowedProfiles = normalizeAllowedProfiles(req.body.allowedProfiles || [], role);
        const password = req.body.password;

        const { rows } = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
        const exists = rows.length > 0;
        if (!exists && typeof password !== 'string') {
            throw new HttpError(400, 'Для нового користувача потрібен пароль.');
        }
        if (typeof password === 'string') validatePassword(password);

        const now = Date.now();
        if (exists) {
            if (typeof password === 'string') {
                await pool.query(
                    'UPDATE users SET role=$1, allowed_profiles=$2, password_hash=$3, updated_at=$4 WHERE username=$5',
                    [role, JSON.stringify(allowedProfiles), hashPassword(password), now, username]
                );
            } else {
                await pool.query(
                    'UPDATE users SET role=$1, allowed_profiles=$2, updated_at=$3 WHERE username=$4',
                    [role, JSON.stringify(allowedProfiles), now, username]
                );
            }
        } else {
            await pool.query(
                'INSERT INTO users (username, role, allowed_profiles, password_hash, must_change_password, created_at, updated_at) VALUES ($1,$2,$3,$4,false,$5,$5)',
                [username, role, JSON.stringify(allowedProfiles), hashPassword(password), now]
            );
        }

        backendEvents.emit('team-user-updated', { username, data: { role, allowedProfiles, firebaseUid: username } });
        res.json({ uid: username });
    } catch (err) { next(err); }
});

router.delete('/:username', async (req, res, next) => {
    try {
        const username = normalizeUsername(req.params.username);
        const { rows } = await pool.query('SELECT role FROM users WHERE username=$1', [username]);
        if (rows.length && rows[0].role === 'admin') {
            throw new HttpError(400, 'Не можна видалити адміністратора.');
        }
        await pool.query('DELETE FROM users WHERE username=$1', [username]);
        backendEvents.emit('team-user-revoked', { username });
        res.json({ success: true, deleted: rows.length > 0 });
    } catch (err) { next(err); }
});

module.exports = router;
