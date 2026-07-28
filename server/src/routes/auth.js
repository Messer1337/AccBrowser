const express = require('express');
const { pool } = require('../db');
const { hashPassword, verifyPassword } = require('../auth/password');
const { sign } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');
const { HttpError } = require('../validators');

const router = express.Router();

router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string') {
            throw new HttpError(400, 'Потрібні username та password.');
        }
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
        const user = rows[0];
        if (!user) throw new HttpError(404, 'Користувача не знайдено.');
        if (!verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Невірний пароль.');
        const token = sign(user.username);
        res.json({
            token,
            user: { uid: user.username, role: user.role, allowedProfiles: user.allowed_profiles }
        });
    } catch (err) { next(err); }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
    try {
        const { newPassword } = req.body || {};
        if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256 || newPassword.toLowerCase() === 'admin') {
            throw new HttpError(400, 'Пароль має містити від 12 до 256 символів і не може бути "admin".');
        }
        await pool.query(
            'UPDATE users SET password_hash=$1, must_change_password=false, updated_at=$2 WHERE username=$3',
            [hashPassword(newPassword), Date.now(), req.user.username]
        );
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;
