const express = require('express');
const { pool, withTransaction } = require('../db');
const { requireAuth, requireAdmin, hasProfileAccess } = require('../auth/middleware');
const {
    validateProfileId, validateDeviceId, validateCookies, validateFingerprint,
    validateExpectedRevision, validateProfileData, HttpError
} = require('../validators');
const backendEvents = require('../events');

const router = express.Router();
router.use(requireAuth);

const LEASE_TTL_MS = 2 * 60 * 1000;

function toProfileResponse(row) {
    return {
        id: row.id,
        name: row.name,
        url: row.url,
        proxy: row.proxy,
        proxyRotateUrl: row.proxy_rotate_url || '',
        folder: row.folder || '',
        tags: Array.isArray(row.tags) ? row.tags : [],
        userAgent: row.user_agent,
        timezone: row.timezone,
        cookies: row.cookies,
        fingerprint: row.fingerprint,
        fingerprintHeaders: row.fingerprint_headers,
        fingerprintUpdatedAt: row.fingerprint_updated_at !== null ? Number(row.fingerprint_updated_at) : null,
        activeHolder: row.active_holder,
        revision: row.revision,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at !== null ? Number(row.updated_at) : null,
        lastSyncUser: row.last_sync_user,
        lastSyncDevice: row.last_sync_device
    };
}

function requireAccess(req, res, next) {
    const id = validateProfileId(req.params.id);
    if (!hasProfileAccess(req.user, id)) {
        return res.status(403).json({ message: 'Немає доступу до цього профілю.' });
    }
    next();
}

function emitChange(type, row) {
    const data = toProfileResponse(row);
    backendEvents.emit('profile-updated', { profileId: row.id, data });
    backendEvents.emit('profiles-changed', [{ type, data }]);
}

// Non-admins must pass explicit ids; the server intersects against the caller's own
// DB-stored allowedProfiles rather than trusting the client's list. This is a
// simplification over the Firebase path, where Firestore Rules forbid a single
// mixed-ACL collection query and force the client into N per-document fetches instead.
router.get('/', async (req, res, next) => {
    try {
        if (req.user.role === 'admin') {
            const { rows } = await pool.query('SELECT * FROM profiles');
            return res.json({ profiles: rows.map(toProfileResponse) });
        }
        const requestedIds = typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(Boolean) : [];
        const allowed = Array.isArray(req.user.allowed_profiles) ? req.user.allowed_profiles : [];
        if (allowed.includes('*')) {
            if (requestedIds.length > 0) {
                const { rows } = await pool.query('SELECT * FROM profiles WHERE id = ANY($1)', [requestedIds]);
                return res.json({ profiles: rows.map(toProfileResponse) });
            }
            const { rows } = await pool.query('SELECT * FROM profiles');
            return res.json({ profiles: rows.map(toProfileResponse) });
        }
        const targetIds = requestedIds.length > 0 ? requestedIds.filter(id => allowed.includes(id)) : allowed;
        if (targetIds.length === 0) return res.json({ profiles: [] });
        const { rows } = await pool.query('SELECT * FROM profiles WHERE id = ANY($1)', [targetIds]);
        res.json({ profiles: rows.map(toProfileResponse) });
    } catch (err) { next(err); }
});

router.get('/:id', requireAccess, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM profiles WHERE id=$1', [req.params.id]);
        if (!rows.length) throw new HttpError(404, 'Профіль не знайдено.');
        res.json(toProfileResponse(rows[0]));
    } catch (err) { next(err); }
});

// Admin-only full metadata save, revision-gated — direct analog of SyncManager's
// client-side runTransaction against Firestore in 'full' cloudMode.
router.put('/:id', requireAdmin, async (req, res, next) => {
    try {
        const id = validateProfileId(req.params.id);
        const data = validateProfileData(req.body.data);
        const expectedRevision = validateExpectedRevision(req.body.expectedRevision);

        const row = await withTransaction(async (client) => {
            const { rows } = await client.query('SELECT * FROM profiles WHERE id=$1 FOR UPDATE', [id]);
            const exists = rows.length > 0;
            const currentRevision = exists ? rows[0].revision : 0;
            if (exists && expectedRevision !== currentRevision) {
                throw new HttpError(409, 'Конфлікт синхронізації: профіль змінився на іншому пристрої. Оновіть дані перед повторним збереженням.');
            }
            const revision = currentRevision + 1;
            const updatedAt = Date.now();
            const updatedBy = req.user.username;
            const params = [
                id, data.name, data.url, data.proxy || '', data.proxyRotateUrl || '',
                data.folder || '', JSON.stringify(Array.isArray(data.tags) ? data.tags : []),
                data.userAgent || '', data.timezone || '',
                JSON.stringify(data.cookies), JSON.stringify(data.fingerprint || null),
                JSON.stringify(data.fingerprintHeaders || {}), revision, updatedBy, updatedAt
            ];
            const { rows: written } = await client.query(
                `INSERT INTO profiles (id, name, url, proxy, proxy_rotate_url, folder, tags, user_agent, timezone, cookies, fingerprint, fingerprint_headers, revision, updated_by, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                 ON CONFLICT (id) DO UPDATE SET
                   name=EXCLUDED.name, url=EXCLUDED.url, proxy=EXCLUDED.proxy, proxy_rotate_url=EXCLUDED.proxy_rotate_url,
                   folder=EXCLUDED.folder, tags=EXCLUDED.tags,
                   user_agent=EXCLUDED.user_agent, timezone=EXCLUDED.timezone, cookies=EXCLUDED.cookies,
                   fingerprint=EXCLUDED.fingerprint, fingerprint_headers=EXCLUDED.fingerprint_headers,
                   revision=EXCLUDED.revision, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at
                 RETURNING *`,
                params
            );
            return written[0];
        });

        emitChange(row.revision === 1 ? 'added' : 'modified', row);
        res.json({ revision: row.revision, updatedAt: Number(row.updated_at), updatedBy: row.updated_by });
    } catch (err) { next(err); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
    try {
        const id = validateProfileId(req.params.id);
        const { rows } = await pool.query('DELETE FROM profiles WHERE id=$1 RETURNING id', [id]);
        if (rows.length) {
            backendEvents.emit('profiles-changed', [{ type: 'removed', data: { id } }]);
        }
        res.json({ success: true });
    } catch (err) { next(err); }
});

// Cookie-only sync while a browser session is live. Requires the caller to hold a
// live lease for this exact deviceId AND a matching expectedRevision — the same two
function getActiveHolders(activeHolderRaw) {
    if (!activeHolderRaw) return [];
    const holders = Array.isArray(activeHolderRaw) ? activeHolderRaw : [activeHolderRaw];
    const now = Date.now();
    return holders.filter(h => h && typeof h === 'object' && h.deviceId && Number(h.expiresAt || 0) > now);
}

// invariants functions/index.js's syncProfileSession enforced.
router.post('/:id/session-sync', requireAccess, async (req, res, next) => {
    try {
        const id = req.params.id;
        const deviceId = validateDeviceId(req.body.deviceId);
        const cookies = validateCookies(req.body.cookies);
        const expectedRevision = validateExpectedRevision(req.body.expectedRevision);

        const row = await withTransaction(async (client) => {
            const { rows } = await client.query('SELECT * FROM profiles WHERE id=$1 FOR UPDATE', [id]);
            if (!rows.length) throw new HttpError(404, 'Профіль не знайдено.');
            const current = rows[0];
            const now = Date.now();
            const holders = getActiveHolders(current.active_holder);
            const activeDeviceHolder = holders.find(h => h.deviceId === deviceId);
            if (!activeDeviceHolder) {
                throw new HttpError(409, 'Потрібен чинний lease профілю для синхронізації сесії.');
            }
            const revision = current.revision + 1;
            const updatedAt = now;
            const updatedBy = req.user.username;
            const { rows: written } = await client.query(
                `UPDATE profiles SET cookies=$1, revision=$2, updated_by=$3, updated_at=$4, last_sync_user=$5, last_sync_device=$6
                 WHERE id=$7 RETURNING *`,
                [JSON.stringify(cookies), revision, updatedBy, updatedAt, updatedBy, deviceId, id]
            );
            return written[0];
        });

        emitChange('modified', row);
        res.json({ revision: row.revision, updatedAt: Number(row.updated_at), updatedBy: row.updated_by });
    } catch (err) { next(err); }
});

// First-claimer-wins: if a fingerprint is already stored, it's returned as-is and the
// caller's proposal is ignored, so parallel devices converge on one identity.
router.post('/:id/fingerprint', requireAccess, async (req, res, next) => {
    try {
        const id = req.params.id;
        const fingerprint = validateFingerprint(req.body.fingerprint, 'fingerprint');
        const fingerprintHeaders = validateFingerprint(req.body.fingerprintHeaders || {}, 'fingerprintHeaders');

        const result = await withTransaction(async (client) => {
            const { rows } = await client.query('SELECT * FROM profiles WHERE id=$1 FOR UPDATE', [id]);
            if (!rows.length) throw new HttpError(404, 'Профіль не знайдено.');
            const current = rows[0];
            if (current.fingerprint) {
                return {
                    row: current,
                    payload: {
                        fingerprint: current.fingerprint,
                        fingerprintHeaders: current.fingerprint_headers || {},
                        fingerprintUpdatedAt: current.fingerprint_updated_at !== null ? Number(current.fingerprint_updated_at) : null,
                        revision: current.revision
                    }
                };
            }
            const fingerprintUpdatedAt = Date.now();
            const revision = current.revision + 1;
            const { rows: written } = await client.query(
                `UPDATE profiles SET fingerprint=$1, fingerprint_headers=$2, fingerprint_updated_at=$3, revision=$4, updated_by=$5, updated_at=$6
                 WHERE id=$7 RETURNING *`,
                [JSON.stringify(fingerprint), JSON.stringify(fingerprintHeaders), fingerprintUpdatedAt, revision, req.user.username, fingerprintUpdatedAt, id]
            );
            return {
                row: written[0],
                payload: { fingerprint, fingerprintHeaders, fingerprintUpdatedAt, revision }
            };
        });

        emitChange('modified', result.row);
        res.json(result.payload);
    } catch (err) { next(err); }
});

router.post('/:id/lease/claim', requireAccess, async (req, res, next) => {
    try {
        const id = req.params.id;
        const deviceId = validateDeviceId(req.body.deviceId);

        const { row, activeHolder } = await withTransaction(async (client) => {
            const { rows } = await client.query('SELECT * FROM profiles WHERE id=$1 FOR UPDATE', [id]);
            if (!rows.length) throw new HttpError(404, 'Профіль не знайдено.');
            const current = rows[0];
            const now = Date.now();
            let holders = getActiveHolders(current.active_holder);
            let myHolder = holders.find(h => h.deviceId === deviceId);
            if (myHolder) {
                myHolder.expiresAt = now + LEASE_TTL_MS;
                myHolder.username = req.user.username;
            } else {
                myHolder = { username: req.user.username, deviceId, launchedAt: now, expiresAt: now + LEASE_TTL_MS };
                holders.push(myHolder);
            }
            const { rows: written } = await client.query('UPDATE profiles SET active_holder=$1 WHERE id=$2 RETURNING *', [JSON.stringify(holders), id]);
            return { row: written[0], activeHolder: myHolder };
        });

        emitChange('modified', row);
        res.json({ activeHolder });
    } catch (err) { next(err); }
});

router.post('/:id/lease/heartbeat', requireAccess, async (req, res, next) => {
    try {
        const id = req.params.id;
        const deviceId = validateDeviceId(req.body.deviceId);

        const activeHolder = await withTransaction(async (client) => {
            const { rows } = await client.query('SELECT * FROM profiles WHERE id=$1 FOR UPDATE', [id]);
            if (!rows.length) throw new HttpError(404, 'Профіль не знайдено.');
            const current = rows[0];
            const now = Date.now();
            let holders = getActiveHolders(current.active_holder);
            let myHolder = holders.find(h => h.deviceId === deviceId);
            if (!myHolder) {
                throw new HttpError(409, 'Lease профілю більше не належить цьому пристрою.');
            }
            myHolder.expiresAt = now + LEASE_TTL_MS;
            myHolder.username = req.user.username;
            await client.query('UPDATE profiles SET active_holder=$1 WHERE id=$2', [JSON.stringify(holders), id]);
            return myHolder;
        });

        res.json({ activeHolder });
    } catch (err) { next(err); }
});

router.post('/:id/lease/release', requireAccess, async (req, res, next) => {
    try {
        const id = req.params.id;
        const deviceId = validateDeviceId(req.body.deviceId);

        const row = await withTransaction(async (client) => {
            const { rows } = await client.query('SELECT * FROM profiles WHERE id=$1 FOR UPDATE', [id]);
            if (!rows.length) return null;
            let holders = getActiveHolders(rows[0].active_holder);
            holders = holders.filter(h => h.deviceId !== deviceId);
            const newPayload = holders.length > 0 ? JSON.stringify(holders) : null;
            const { rows: written } = await client.query('UPDATE profiles SET active_holder=$1 WHERE id=$2 RETURNING *', [newPayload, id]);
            return written[0];
        });

        if (row) emitChange('modified', row);
        res.json({ activeHolder: null });
    } catch (err) { next(err); }
});

module.exports = router;
