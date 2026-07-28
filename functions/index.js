const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const auth = getAuth();

function normalizeUsername(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(value)) {
        throw new HttpsError('invalid-argument', 'Некоректне ім’я користувача.');
    }
    return value.toLowerCase();
}

function validateRole(value) {
    if (!['admin', 'user'].includes(value)) {
        throw new HttpsError('invalid-argument', 'Некоректна роль користувача.');
    }
    return value;
}

function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 256 || value.toLowerCase() === 'admin') {
        throw new HttpsError('invalid-argument', 'Пароль має містити від 12 до 256 символів і не може бути "admin".');
    }
}

function normalizeAllowedProfiles(value, role) {
    if (role === 'admin') return ['*'];
    if (!Array.isArray(value) || value.length > 500) {
        throw new HttpsError('invalid-argument', 'Некоректний перелік доступних профілів.');
    }
    const unique = new Set();
    for (const id of value) {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            throw new HttpsError('invalid-argument', 'Некоректний ID профілю.');
        }
        unique.add(id);
    }
    return [...unique];
}

function emailFor(username) {
    return `${encodeURIComponent(username)}@oasis-browser.local`;
}

// Kept only as a compatibility bridge for existing client-created Firebase accounts.
// The Electron client never receives an Admin SDK credential; a future credential migration
// can switch this function and the client login together without exposing old hashes in Firestore.
function firebasePasswordFor(password) {
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    return crypto.createHash('sha256').update(`${legacyHash}:oasis-firebase-pepper`).digest('hex');
}

async function requireAdmin(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Потрібна авторизація.');
    }
    const actorDoc = await db.collection('authorizedUsers').doc(request.auth.uid).get();
    if (!actorDoc.exists || actorDoc.get('role') !== 'admin') {
        throw new HttpsError('permission-denied', 'Лише cloud-адміністратор може керувати користувачами.');
    }
    return actorDoc;
}

async function requireProfileAccess(request, profileId) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Потрібна авторизація.');
    }
    const actorDoc = await db.collection('authorizedUsers').doc(request.auth.uid).get();
    if (!actorDoc.exists) {
        throw new HttpsError('permission-denied', 'Акаунт не авторизовано для команди.');
    }
    const actor = actorDoc.data();
    const allowedProfiles = Array.isArray(actor.allowedProfiles) ? actor.allowedProfiles : [];
    if (actor.role !== 'admin' && !allowedProfiles.includes('*') && !allowedProfiles.includes(profileId)) {
        throw new HttpsError('permission-denied', 'Немає доступу до цього профілю.');
    }
    return actor;
}

function validateDeviceId(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 160) {
        throw new HttpsError('invalid-argument', 'Некоректний ідентифікатор пристрою.');
    }
    return value;
}

function validateCookies(value) {
    if (!Array.isArray(value) || value.length > 5000) {
        throw new HttpsError('invalid-argument', 'Некоректний або надто великий масив cookies.');
    }
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 700000) {
        throw new HttpsError('resource-exhausted', 'Cookies перевищують ліміт безпечної синхронізації (700 KB).');
    }
    return value;
}

function validateFingerprint(value, fieldName) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpsError('invalid-argument', `Некоректне поле ${fieldName}.`);
    }
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch (error) {
        throw new HttpsError('invalid-argument', `Некоректне поле ${fieldName}.`);
    }
    if (Buffer.byteLength(serialized, 'utf8') > 50000) {
        throw new HttpsError('resource-exhausted', `Поле ${fieldName} перевищує 50 KB.`);
    }
    return JSON.parse(serialized);
}

function validateExpectedRevision(value) {
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
        throw new HttpsError('invalid-argument', 'Некоректна ревізія профілю.');
    }
    return value;
}

// The client never receives Admin SDK credentials. Provisioning, password resets and ACL
// changes are all validated against the caller's server-side authorizedUsers document.
exports.upsertTeamUser = onCall(async (request) => {
    await requireAdmin(request);
    const data = request.data || {};
    const username = normalizeUsername(data.username);
    const role = validateRole(data.role || 'user');
    const allowedProfiles = normalizeAllowedProfiles(data.allowedProfiles || [], role);
    const password = data.password;
    const teamUserRef = db.collection('teamUsers').doc(username);
    const existing = await teamUserRef.get();
    let firebaseUid = existing.exists ? existing.get('firebaseUid') : null;

    if (!firebaseUid && typeof password !== 'string') {
        throw new HttpsError('failed-precondition', 'Для нового користувача потрібен пароль.');
    }

    if (typeof password === 'string') {
        validatePassword(password);
        const firebasePassword = firebasePasswordFor(password);
        if (firebaseUid) {
            await auth.updateUser(firebaseUid, { password: firebasePassword });
        } else {
            try {
                const existingAuthUser = await auth.getUserByEmail(emailFor(username));
                firebaseUid = existingAuthUser.uid;
                await auth.updateUser(firebaseUid, { password: firebasePassword });
            } catch (error) {
                if (error.code !== 'auth/user-not-found') throw error;
                firebaseUid = (await auth.createUser({ email: emailFor(username), password: firebasePassword })).uid;
            }
        }
    }

    const batch = db.batch();
    batch.set(teamUserRef, {
        username,
        role,
        allowedProfiles,
        firebaseUid,
        updatedAt: Date.now(),
        passwordHash: FieldValue.delete()
    }, { merge: true });
    batch.set(db.collection('authorizedUsers').doc(firebaseUid), {
        username,
        role,
        allowedProfiles
    }, { merge: true });
    await batch.commit();

    return { success: true, firebaseUid };
});

exports.deleteTeamUser = onCall(async (request) => {
    await requireAdmin(request);
    const username = normalizeUsername((request.data || {}).username);
    const teamUserRef = db.collection('teamUsers').doc(username);
    const existing = await teamUserRef.get();
    if (!existing.exists) return { success: true, deleted: false };
    if (existing.get('role') === 'admin') {
        throw new HttpsError('failed-precondition', 'Не можна видалити адміністратора.');
    }
    const firebaseUid = existing.get('firebaseUid');
    const batch = db.batch();
    batch.delete(teamUserRef);
    if (firebaseUid) batch.delete(db.collection('authorizedUsers').doc(firebaseUid));
    await batch.commit();
    if (firebaseUid) {
        try {
            await auth.deleteUser(firebaseUid);
        } catch (error) {
            console.error(`Could not delete Firebase Auth user ${firebaseUid}:`, error);
        }
    }
    return { success: true, deleted: true };
});

exports.claimProfileLease = onCall(async (request) => {
    const profileId = normalizeAllowedProfiles([(request.data || {}).profileId], 'user')[0];
    const deviceId = validateDeviceId((request.data || {}).deviceId);
    const actor = await requireProfileAccess(request, profileId);
    const profileRef = db.collection('profiles').doc(profileId);
    const now = Date.now();
    const expiresAt = now + 2 * 60 * 1000;
    const activeHolder = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(profileRef);
        if (!snapshot.exists) throw new HttpsError('not-found', 'Профіль не знайдено.');
        const current = snapshot.get('activeHolder');
        if (current && current.deviceId !== deviceId && Number(current.expiresAt || 0) > now) {
            throw new HttpsError('failed-precondition', `Профіль зайнято користувачем ${current.username || 'іншого пристрою'}.`);
        }
        const holder = { username: actor.username, deviceId, launchedAt: now, expiresAt };
        transaction.update(profileRef, { activeHolder: holder });
        return holder;
    });
    return { activeHolder };
});

exports.heartbeatProfileLease = onCall(async (request) => {
    const profileId = normalizeAllowedProfiles([(request.data || {}).profileId], 'user')[0];
    const deviceId = validateDeviceId((request.data || {}).deviceId);
    const actor = await requireProfileAccess(request, profileId);
    const profileRef = db.collection('profiles').doc(profileId);
    const now = Date.now();
    const expiresAt = now + 2 * 60 * 1000;
    const activeHolder = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(profileRef);
        if (!snapshot.exists) throw new HttpsError('not-found', 'Профіль не знайдено.');
        const current = snapshot.get('activeHolder');
        if (!current || current.deviceId !== deviceId) {
            throw new HttpsError('failed-precondition', 'Lease профілю більше не належить цьому пристрою.');
        }
        const holder = { username: actor.username, deviceId, launchedAt: current.launchedAt || now, expiresAt };
        transaction.update(profileRef, { activeHolder: holder });
        return holder;
    });
    return { activeHolder };
});

exports.releaseProfileLease = onCall(async (request) => {
    const profileId = normalizeAllowedProfiles([(request.data || {}).profileId], 'user')[0];
    const deviceId = validateDeviceId((request.data || {}).deviceId);
    await requireProfileAccess(request, profileId);
    const profileRef = db.collection('profiles').doc(profileId);
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(profileRef);
        if (!snapshot.exists) return;
        const current = snapshot.get('activeHolder');
        if (current && current.deviceId === deviceId) transaction.update(profileRef, { activeHolder: null });
    });
    return { activeHolder: null };
});

exports.ensureProfileFingerprint = onCall(async (request) => {
    const data = request.data || {};
    const profileId = normalizeAllowedProfiles([data.profileId], 'user')[0];
    const actor = await requireProfileAccess(request, profileId);
    const fingerprint = validateFingerprint(data.fingerprint, 'fingerprint');
    const fingerprintHeaders = validateFingerprint(data.fingerprintHeaders || {}, 'fingerprintHeaders');
    const profileRef = db.collection('profiles').doc(profileId);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(profileRef);
        if (!snapshot.exists) throw new HttpsError('not-found', 'Профіль не знайдено.');
        const existingFingerprint = snapshot.get('fingerprint');
        if (existingFingerprint && typeof existingFingerprint === 'object') {
            return {
                fingerprint: existingFingerprint,
                fingerprintHeaders: snapshot.get('fingerprintHeaders') || {},
                fingerprintUpdatedAt: snapshot.get('fingerprintUpdatedAt') || null,
                revision: Number(snapshot.get('revision') || 0)
            };
        }
        const fingerprintUpdatedAt = Date.now();
        const revision = Number(snapshot.get('revision') || 0) + 1;
        transaction.update(profileRef, { fingerprint, fingerprintHeaders, fingerprintUpdatedAt, revision, updatedBy: actor.username, updatedAt: fingerprintUpdatedAt });
        return { fingerprint, fingerprintHeaders, fingerprintUpdatedAt, revision };
    });
});

exports.syncProfileSession = onCall(async (request) => {
    const data = request.data || {};
    const profileId = normalizeAllowedProfiles([data.profileId], 'user')[0];
    const deviceId = validateDeviceId(data.deviceId);
    const actor = await requireProfileAccess(request, profileId);
    const cookies = validateCookies(data.cookies);
    const expectedRevision = validateExpectedRevision(data.expectedRevision);
    const profileRef = db.collection('profiles').doc(profileId);
    const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(profileRef);
        if (!snapshot.exists) throw new HttpsError('not-found', 'Профіль не знайдено.');
        const holder = snapshot.get('activeHolder');
        if (!holder || holder.deviceId !== deviceId || Number(holder.expiresAt || 0) <= Date.now()) {
            throw new HttpsError('failed-precondition', 'Потрібен чинний lease профілю для синхронізації сесії.');
        }
        const currentRevision = Number(snapshot.get('revision') || 0);
        if (expectedRevision !== currentRevision) {
            throw new HttpsError('failed-precondition', 'Конфлікт синхронізації: профіль змінився на іншому пристрої.');
        }
        const updatedAt = Date.now();
        const revision = currentRevision + 1;
        transaction.update(profileRef, { cookies, updatedAt, updatedBy: actor.username, revision, lastSyncUser: actor.username, lastSyncDevice: deviceId });
        return { revision, updatedAt, updatedBy: actor.username };
    });
    return { success: true, ...result };
});
