const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../auth/middleware');
const { HttpError } = require('../validators');

const router = express.Router();
router.use(requireAuth);

// username is always taken from the authenticated identity, never the request body —
// stronger than firestore.rules' equality-check anti-spoofing pattern, which could only
// verify a client-supplied username matched the caller's own record after the fact.
router.post('/', async (req, res, next) => {
    try {
        const { action, profileId, profileName, details, deviceId } = req.body || {};
        if (typeof action !== 'string' || action.length === 0) {
            throw new HttpError(400, 'Некоректна дія аудиту.');
        }
        const timestamp = Date.now();
        await pool.query(
            'INSERT INTO audit_logs (action, username, profile_id, profile_name, details, device_id, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [action, req.user.username, profileId || null, profileName || null, details || '', deviceId || null, timestamp]
        );
        res.json({ success: true });
    } catch (err) { next(err); }
});

router.get('/', requireAdmin, async (req, res, next) => {
    try {
        const limitCount = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT $1', [limitCount]);
        res.json({
            logs: rows.map(r => ({
                id: String(r.id),
                action: r.action,
                username: r.username,
                profileId: r.profile_id,
                profileName: r.profile_name,
                details: r.details,
                deviceId: r.device_id,
                timestamp: Number(r.timestamp)
            }))
        });
    } catch (err) { next(err); }
});

module.exports = router;
