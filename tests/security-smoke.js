const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AuthManager = require('../src/main/auth-manager');
const SyncManager = require('../src/main/sync-manager');
const BrowserLauncher = require('../src/main/browser-launcher');
const PreflightChecker = require('../src/main/preflight-checker');
const { validateCookiesPayload, validateProfilePayload } = require('../src/main/profile-validation');

function expectThrow(callback, pattern) {
    assert.throws(callback, pattern);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-security-test-'));
try {
    const password = 'Correct horse battery staple 2026';
    const manager = new AuthManager(temporaryDirectory);
    const stored = manager.hashPassword(password);
    assert.equal(manager.verifyPassword(password, stored).valid, true);
    assert.equal(manager.verifyPassword('wrong password', stored).valid, false);
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    assert.deepEqual(manager.verifyPassword(password, legacyHash), { valid: true, needsUpgrade: true });

    const syncManager = new SyncManager(temporaryDirectory);
    const cookies = [{ name: 'session', value: 'abc', domain: '.example.com', path: '/', secure: true, httpOnly: true }];
    assert.equal(syncManager.hasCookieChanges('profile_1', cookies), true);
    syncManager.cookieHashes.set('profile_1', syncManager.getCookiesHash(cookies));
    assert.equal(syncManager.hasCookieChanges('profile_1', cookies), false);
    expectThrow(() => syncManager.validateCookiesForCloudSync([{ value: 'x'.repeat(700001) }]), /перевищують cloud-ліміт/);

    const fakeSafeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, '')
    };
    const encryptedSyncManager = new SyncManager(temporaryDirectory, fakeSafeStorage);
    const encryptedProfile = encryptedSyncManager.encodeLocalProfile({ id: 'profile_1', cookies });
    assert.equal(Object.hasOwn(encryptedProfile, 'cookies'), false);
    assert.ok(encryptedProfile.cookiesEncrypted && !encryptedProfile.cookiesEncrypted.includes('session'));
    assert.deepEqual(encryptedSyncManager.decodeLocalProfile(encryptedProfile).cookies, cookies);

    for (const proxy of ['http://user:pass@127.0.0.1:8080', 'socks5://u%40ser:p%3Ass@[2001:db8::1]:1080', '127.0.0.1:8080:user:pass']) {
        assert.ok(PreflightChecker.parseProxy(proxy), `Proxy was not parsed: ${proxy}`);
    }
    const validProfile = validateProfilePayload({
        id: 'profile_1', name: 'Profile', url: 'https://example.com', proxy: '', userAgent: '', timezone: 'Europe/Kyiv', cookies
    }, PreflightChecker.parseProxy);
    assert.equal(validProfile.id, 'profile_1');
    expectThrow(() => validateProfilePayload({ ...validProfile, id: '../escape' }, PreflightChecker.parseProxy), /ID профілю/);
    expectThrow(() => validateProfilePayload({ ...validProfile, url: 'file:///etc/passwd' }, PreflightChecker.parseProxy), /HTTP\(S\)/);
    expectThrow(() => validateCookiesPayload(new Array(5001).fill({})), /5 000/);

    const launcher = new BrowserLauncher(temporaryDirectory, syncManager);
    const fallbackFingerprint = launcher.generateFingerprint(120);
    assert.ok(fallbackFingerprint.fingerprint.navigator.userAgent, 'Fingerprint fallback must remain launchable');

    const functionsSource = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');
    for (const symbol of ['requireProfileAccess', 'claimProfileLease', 'ensureProfileFingerprint', 'syncProfileSession', 'validateExpectedRevision', 'expectedRevision']) {
        assert.ok(functionsSource.includes(symbol), `Missing protected Function: ${symbol}`);
    }
    console.log('security smoke tests: ok');
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
