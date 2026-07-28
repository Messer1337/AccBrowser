const crypto = require('crypto');

// Same scrypt format AuthManager writes locally in the Electron client
// (scrypt$16384$8$1$<salt>$<hash>) — a device's local verifier and this server's
// verifier are directly comparable/interchangeable if ever needed for migration.
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024
    });
    return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string' || !storedHash.startsWith('scrypt$')) {
        return false;
    }
    const [, nValue, rValue, pValue, saltValue, hashValue] = storedHash.split('$');
    const N = Number(nValue);
    const r = Number(rValue);
    const p = Number(pValue);
    if (N !== 16384 || r !== 8 || p !== 1 || !saltValue || !hashValue) return false;
    try {
        const expected = Buffer.from(hashValue, 'base64');
        const actual = crypto.scryptSync(password, Buffer.from(saltValue, 'base64'), expected.length, {
            N, r, p, maxmem: 64 * 1024 * 1024
        });
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch (e) {
        return false;
    }
}

module.exports = { hashPassword, verifyPassword };
