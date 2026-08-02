// Ported 1:1 from functions/index.js (the Firebase Cloud Functions this server replaces)
// and firestore.rules' isValidProfile, so both backends enforce the exact same limits.
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function normalizeUsername(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(value)) {
        throw new HttpError(400, 'Некоректне ім’я користувача.');
    }
    return value.toLowerCase();
}

function validateRole(value) {
    if (!['admin', 'user'].includes(value)) {
        throw new HttpError(400, 'Некоректна роль користувача.');
    }
    return value;
}

function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 256 || value.toLowerCase() === 'admin') {
        throw new HttpError(400, 'Пароль має містити від 12 до 256 символів і не може бути "admin".');
    }
}

function normalizeAllowedProfiles(value, role) {
    if (role === 'admin') return ['*'];
    if (!Array.isArray(value) || value.length > 500) {
        throw new HttpError(400, 'Некоректний перелік доступних профілів.');
    }
    const unique = new Set();
    for (const id of value) {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            throw new HttpError(400, 'Некоректний ID профілю.');
        }
        unique.add(id);
    }
    return [...unique];
}

function validateProfileId(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new HttpError(400, 'Некоректний ID профілю.');
    }
    return id;
}

function validateDeviceId(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 160) {
        throw new HttpError(400, 'Некоректний ідентифікатор пристрою.');
    }
    return value;
}

function validateCookies(value) {
    if (!Array.isArray(value) || value.length > 5000) {
        throw new HttpError(400, 'Некоректний або надто великий масив cookies.');
    }
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 700000) {
        throw new HttpError(413, 'Cookies перевищують ліміт безпечної синхронізації (700 KB).');
    }
    return value;
}

function validateFingerprint(value, fieldName) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpError(400, `Некоректне поле ${fieldName}.`);
    }
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch (error) {
        throw new HttpError(400, `Некоректне поле ${fieldName}.`);
    }
    if (Buffer.byteLength(serialized, 'utf8') > 50000) {
        throw new HttpError(413, `Поле ${fieldName} перевищує 50 KB.`);
    }
    return JSON.parse(serialized);
}

function validateExpectedRevision(value) {
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
        throw new HttpError(400, 'Некоректна ревізія профілю.');
    }
    return value;
}

// Mirrors firestore.rules' isValidProfile allowlist/size caps for a client-supplied
// full-metadata save (admin PUT /api/profiles/:id).
function validateProfileData(data) {
    if (!data || typeof data !== 'object') {
        throw new HttpError(400, 'Некоректні дані профілю.');
    }
    if (typeof data.name !== 'string' || data.name.length === 0 || data.name.length > 120) {
        throw new HttpError(400, 'Некоректна назва профілю.');
    }
    if (typeof data.url !== 'string' || data.url.length === 0 || data.url.length > 4096) {
        throw new HttpError(400, 'Некоректний URL профілю.');
    }
    if (!Array.isArray(data.cookies)) {
        throw new HttpError(400, 'Некоректний масив cookies.');
    }
    validateCookies(data.cookies);
    if (data.proxy !== undefined && data.proxy !== null && (typeof data.proxy !== 'string' || data.proxy.length > 4096)) {
        throw new HttpError(400, 'Некоректний proxy.');
    }
    if (data.proxyRotateUrl !== undefined && data.proxyRotateUrl !== null && (typeof data.proxyRotateUrl !== 'string' || data.proxyRotateUrl.length > 4096)) {
        throw new HttpError(400, 'Некоректний URL ротації проксі.');
    }
    if (data.folder !== undefined && data.folder !== null && (typeof data.folder !== 'string' || data.folder.length > 120)) {
        throw new HttpError(400, 'Некоректна папка профілю.');
    }
    if (data.tags !== undefined && data.tags !== null && (!Array.isArray(data.tags) || data.tags.some(t => typeof t !== 'string' || t.length > 60))) {
        throw new HttpError(400, 'Некоректні теги профілю.');
    }
    if (data.userAgent !== undefined && data.userAgent !== null && (typeof data.userAgent !== 'string' || data.userAgent.length > 2048)) {
        throw new HttpError(400, 'Некоректний userAgent.');
    }
    if (data.timezone !== undefined && data.timezone !== null && (typeof data.timezone !== 'string' || data.timezone.length > 128)) {
        throw new HttpError(400, 'Некоректний timezone.');
    }
    if (data.updatedBy !== undefined && data.updatedBy !== null && (typeof data.updatedBy !== 'string' || data.updatedBy.length > 64)) {
        throw new HttpError(400, 'Некоректний updatedBy.');
    }
    if (data.lastSyncUser !== undefined && data.lastSyncUser !== null && (typeof data.lastSyncUser !== 'string' || data.lastSyncUser.length > 64)) {
        throw new HttpError(400, 'Некоректний lastSyncUser.');
    }
    if (data.lastSyncDevice !== undefined && data.lastSyncDevice !== null && (typeof data.lastSyncDevice !== 'string' || data.lastSyncDevice.length > 160)) {
        throw new HttpError(400, 'Некоректний lastSyncDevice.');
    }
    return data;
}

module.exports = {
    HttpError,
    normalizeUsername,
    validateRole,
    validatePassword,
    normalizeAllowedProfiles,
    validateProfileId,
    validateDeviceId,
    validateCookies,
    validateFingerprint,
    validateExpectedRevision,
    validateProfileData
};
