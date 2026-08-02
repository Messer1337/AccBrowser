const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { getBackendProvider } = require('../config/backend');

class AuthManager {
    constructor(userDataPath) {
        this.userDataPath = userDataPath;
        fs.ensureDirSync(userDataPath);
        this.usersFile = path.join(userDataPath, 'users.json');
        this.sessionFile = path.join(userDataPath, 'session.json');
        this.currentUser = null;
        this.userUnsubscribe = null;
        this.onForceLogoutCallback = null;
        this.initialSetupRequired = false;
        this.initDefaultUsers();
    }

    onForceLogout(callback) {
        this.onForceLogoutCallback = callback;
    }

    async revokeSession(username, reason = 'Акаунт було відкликано адміністратором.') {
        console.warn(`[AuthManager] Revoking session for user '${username}'. Reason: ${reason}`);
        let users = this.getUsers();
        users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
        try {
            fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
        } catch (error) {
            console.warn('[AuthManager] Local revocation write notice:', error.message);
        }

        await this._destroyOwnFirebaseAuthAccount();
        await this.logout();

        if (typeof this.onForceLogoutCallback === 'function') {
            this.onForceLogoutCallback({ username, reason });
        }
    }

    // Account deletion is a backend responsibility. A revoked client only clears its own
    // local session; deleteTeamUser removes the remote identity server-side.
    async _destroyOwnFirebaseAuthAccount() {
        try {
            await getBackendProvider().logout();
        } catch (e) {
            console.warn('[AuthManager] Could not clear backend session after revocation:', e.message);
        }
    }

    hashPassword(password) {
        const salt = crypto.randomBytes(16);
        const derived = crypto.scryptSync(password, salt, 64, {
            N: 16384,
            r: 8,
            p: 1,
            maxmem: 64 * 1024 * 1024
        });
        return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
    }

    verifyPassword(password, storedHash) {
        if (typeof password !== 'string' || typeof storedHash !== 'string') {
            return { valid: false, needsUpgrade: false };
        }
        if (storedHash.startsWith('scrypt$')) {
            const [, nValue, rValue, pValue, saltValue, hashValue] = storedHash.split('$');
            const N = Number(nValue);
            const r = Number(rValue);
            const p = Number(pValue);
            if (N !== 16384 || r !== 8 || p !== 1 || !saltValue || !hashValue) {
                return { valid: false, needsUpgrade: false };
            }
            try {
                const expected = Buffer.from(hashValue, 'base64');
                const actual = crypto.scryptSync(password, Buffer.from(saltValue, 'base64'), expected.length, {
                    N,
                    r,
                    p,
                    maxmem: 64 * 1024 * 1024
                });
                return {
                    valid: expected.length === actual.length && crypto.timingSafeEqual(expected, actual),
                    needsUpgrade: false
                };
            } catch (e) {
                return { valid: false, needsUpgrade: false };
            }
        }

        // Existing devices may still carry a legacy unsalted SHA-256 verifier. Accept it
        // once and immediately replace it with scrypt after a successful local login.
        if (/^[a-f0-9]{64}$/i.test(storedHash)) {
            const actual = crypto.createHash('sha256').update(password).digest('hex');
            return {
                valid: crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(actual, 'hex')),
                needsUpgrade: true
            };
        }
        return { valid: false, needsUpgrade: false };
    }

    validateNewPassword(password) {
        if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
            throw new Error('Пароль має містити від 12 до 256 символів.');
        }
        if (password.toLowerCase() === 'admin') {
            throw new Error('Пароль не може бути "admin".');
        }
    }

    validateUsername(username) {
        if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) {
            throw new Error('Ім’я користувача має містити 3–64 символи: літери, цифри, ., _ або -.');
        }
    }

    initDefaultUsers() {
        if (!fs.existsSync(this.usersFile)) {
            // Never create a predictable administrator. The renderer completes a one-time
            // setup flow before login is possible.
            fs.writeJsonSync(this.usersFile, [], { spaces: 2 });
            this.initialSetupRequired = true;
        } else {
            // Migration check: If old users.json has plain passwords, hash them
            try {
                const users = fs.readJsonSync(this.usersFile);
                if (Array.isArray(users) && users.length === 0) {
                    this.initialSetupRequired = true;
                    return;
                }
                let updated = false;
                for (const u of users) {
                    if (u.password && !u.passwordHash) {
                        const wasDefaultAdmin = u.username === 'admin' && u.password === 'admin';
                        u.passwordHash = this.hashPassword(u.password);
                        delete u.password;
                        if (wasDefaultAdmin) {
                            u.mustChangePassword = true;
                        }
                        updated = true;
                    }
                }
                if (updated) {
                    fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
                }
            } catch (error) {
                console.warn('[AuthManager] Local user migration notice:', error.message);
            }
        }
    }

    needsInitialSetup() {
        return false;
    }

    setupInitialAdmin() {
        throw new Error('Адміністратор керується та ініціалізується виключно на сервері.');
    }

    async restoreSession() {
        // Session restoring is disabled to force a password prompt on every start.
        return;
    }

    saveSession() {
        // Session saving is disabled to force a password prompt on every start.
        try {
            if (fs.existsSync(this.sessionFile)) {
                fs.removeSync(this.sessionFile);
            }
        } catch (error) {
            console.warn('[AuthManager] Session-file cleanup notice:', error.message);
        }
    }

    getUsers() {
        try {
            return fs.readJsonSync(this.usersFile);
        } catch (e) {
            return [];
        }
    }

    persistFirebaseUid(username, uid) {
        const users = this.getUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (user && user.firebaseUid !== uid) {
            user.firebaseUid = uid;
            fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
        }
    }

    // Authenticates against whichever backend is active and resolves this account's
    // role/ACL, applying the same revoke-vs-not-yet-synced distinction used both on the
    // primary login path and the multi-device fallback path below. Never throws:
    // - { authenticated: false } — could not establish a session this attempt (offline,
    //   stale local password, or not yet provisioned). Caller keeps cached local data.
    // - { revoked: true } — the backend record is gone/inaccessible AND this device had
    //   previously trusted it — a real revoke.
    // - { authenticated: true, cloudAuthorized: false, uid } — authenticated, but this
    //   account has no backend record yet (e.g. bootstrap admin before manual setup).
    // - { authenticated: true, cloudAuthorized: true, uid, role, allowedProfiles, firebaseUid }
    async _syncFromBackend(username, password, wasCloudAuthorized) {
        const provider = getBackendProvider();
        try {
            const result = await provider.login(username, password);
            if (!result.authenticated) {
                return { revoked: false, authenticated: false };
            }
            return {
                revoked: false,
                authenticated: true,
                cloudAuthorized: true,
                uid: result.uid,
                role: result.role,
                allowedProfiles: result.allowedProfiles,
                firebaseUid: result.firebaseUid,
                mustChangePassword: result.mustChangePassword
            };
        } catch (err) {
            const isMissingOrDenied = err.code === 'not-found' || err.code === 'permission-denied';
            if (isMissingOrDenied && wasCloudAuthorized) {
                return { revoked: true };
            }
            if (err.code === 'not-found') {
                return { revoked: false, authenticated: true, cloudAuthorized: false, uid: err.uid };
            }
            console.warn(`[AuthManager] Could not sync '${username}' from the backend:`, err.message);
            return { revoked: false, authenticated: false };
        }
    }

    async saveUser(user) {
        this.validateUsername(user && user.username);
        if (!user || !['admin', 'user'].includes(user.role || 'user')) {
            throw new Error('Некоректна роль користувача.');
        }
        const users = this.getUsers();
        const idx = users.findIndex(u => u.username.toLowerCase() === user.username.toLowerCase());
        let userData = { ...user };
        const plainPassword = userData.password;
        if (plainPassword) this.validateNewPassword(plainPassword);
        if (idx === -1 && !plainPassword) {
            throw new Error('Для нового користувача потрібно встановити пароль.');
        }

        if (userData.password) {
            userData.passwordHash = this.hashPassword(userData.password);
            delete userData.password;
        }

        if (idx !== -1) {
            users[idx] = { ...users[idx], ...userData };
            userData = users[idx];
        } else {
            users.push(userData);
        }

        // Sync team user account to the backend & provision its remote identity
        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            try {
                const { uid } = await provider.upsertTeamUser({
                    username: userData.username,
                    role: userData.role || 'user',
                    allowedProfiles: userData.allowedProfiles || [],
                    ...(plainPassword ? { password: plainPassword } : {})
                });
                userData.firebaseUid = uid;
                userData.cloudAuthorized = true;
                users[idx === -1 ? users.length - 1 : idx] = userData;
                fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
                return true;
            } catch (err) {
                throw new Error(`Не вдалося зберегти користувача в захищеному cloud-сервісі: ${err.message}`);
            }
        }
        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
        return true;
    }

    async changePassword(username, newPassword) {
        this.validateNewPassword(newPassword);
        const users = this.getUsers();
        const user = users.find(u => u.username === username);
        if (!user) return { success: false, message: 'Користувача не знайдено' };

        const newHash = this.hashPassword(newPassword);
        user.passwordHash = newHash;
        user.mustChangePassword = false;
        user.updatedAt = Date.now();
        delete user.password;

        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

        if (this.currentUser && this.currentUser.username === username) {
            this.currentUser.mustChangePassword = false;
            // A user may rotate only their own remote credential. Administrator password
            // resets are routed through upsertTeamUser via saveUser().
            await getBackendProvider().changeOwnPassword(newPassword);
        }
        return { success: true };
    }

    async login(username, password) {
        const users = this.getUsers();
        const found = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
        const verification = found ? this.verifyPassword(password, found.passwordHash || '') : { valid: false, needsUpgrade: false };
        const provider = getBackendProvider();

        if (found && (verification.valid || found.password === password)) {
            // Captured BEFORE this login attempt can mutate it: tells a real revoke (record
            // existed before, gone now) apart from "never synced to the backend yet" (e.g.
            // the seed admin before anyone has done the manual authorization step).
            const wasCloudAuthorized = !!found.cloudAuthorized;
            const { passwordHash, password: _pw, firebaseAuthSecret, ...safeUser } = found;
            this.currentUser = safeUser;
            this.saveSession();
            if (verification.needsUpgrade) {
                found.passwordHash = this.hashPassword(password);
                fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
            }

            const syncResult = await this._syncFromBackend(found.username, password, wasCloudAuthorized);

            if (syncResult.revoked) {
                console.warn(`[AuthManager] Login rejected: backend record for '${username}' is gone or inaccessible (revoked).`);
                const remaining = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
                fs.writeJsonSync(this.usersFile, remaining, { spaces: 2 });
                this.currentUser = null;
                this.saveSession();
                await this._destroyOwnFirebaseAuthAccount();
                return { success: false, message: 'Цей акаунт було видалено або відкликано адміністратором.' };
            }

            if (syncResult.authenticated) {
                if (syncResult.uid) this.persistFirebaseUid(found.username, syncResult.uid);
                if (syncResult.cloudAuthorized) {
                    found.role = syncResult.role || found.role;
                    found.allowedProfiles = syncResult.allowedProfiles || found.allowedProfiles;
                    found.firebaseUid = syncResult.firebaseUid || found.firebaseUid;
                    found.cloudAuthorized = true;
                    // The backend is authoritative here (e.g. a migrated account carrying a
                    // temporary password) — only fall back to the local flag when the
                    // backend didn't report one at all.
                    if (syncResult.mustChangePassword !== undefined) found.mustChangePassword = syncResult.mustChangePassword;
                    fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

                    this.currentUser.role = found.role;
                    this.currentUser.allowedProfiles = found.allowedProfiles;
                    this.currentUser.firebaseUid = found.firebaseUid;
                    this.currentUser.cloudAuthorized = true;
                    this.currentUser.mustChangePassword = found.mustChangePassword;
                    console.log(`[AuthManager] Synced role and profiles for '${username}' from the backend.`);
                } else {
                    console.log(`[AuthManager] '${username}' has no backend record yet — continuing with local-only login.`);
                }
            } else {
                console.log(`[AuthManager] No authenticated backend session for '${username}' this attempt (stale local password, offline, or not yet provisioned) — continuing with cached local data.`);
            }

            this.subscribeToCurrentUserDoc();
            return { success: true, user: this.currentUser };
        }

        // Multi-device fallback: if the local password check fails, verify directly with the backend
        if (provider.isConfigured() && username) {
            const localUserBefore = users.find(u => u.username.toLowerCase() === username.toLowerCase());
            const wasCloudAuthorized = !!(localUserBefore && localUserBefore.cloudAuthorized);
            const syncResult = await this._syncFromBackend(username, password, wasCloudAuthorized);

            if (syncResult.revoked) {
                console.warn(`[AuthManager] Fallback login rejected: backend record for '${username}' is gone or inaccessible (revoked).`);
                await this._destroyOwnFirebaseAuthAccount();
                return { success: false, message: 'Цей акаунт було видалено або відкликано адміністратором.' };
            }

            if (syncResult.authenticated) {
                console.log(`[AuthManager] Multi-device password sync: updating local password for '${username}'`);
                let localUser = localUserBefore;
                const role = syncResult.role || (username.toLowerCase() === 'admin' ? 'admin' : 'user');
                const allowedProfiles = syncResult.allowedProfiles || (username.toLowerCase() === 'admin' ? ['*'] : []);

                if (!localUser) {
                    localUser = { username, role, allowedProfiles };
                    users.push(localUser);
                } else {
                    localUser.role = role;
                    localUser.allowedProfiles = allowedProfiles;
                }

                localUser.passwordHash = this.hashPassword(password);
                // Not hardcoded false: a migrated account logging in for the first time on
                // a new device with its distributed temporary password must still be forced
                // to set a real one, even though that temporary password just verified fine.
                localUser.mustChangePassword = Boolean(syncResult.mustChangePassword);
                localUser.firebaseUid = syncResult.firebaseUid || syncResult.uid;
                localUser.cloudAuthorized = syncResult.cloudAuthorized;

                fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

                const { passwordHash: ph, password: p, firebaseAuthSecret, ...safeUser } = localUser;
                this.currentUser = safeUser;
                this.saveSession();
                this.subscribeToCurrentUserDoc();
                return { success: true, user: safeUser };
            }
        }

        return { success: false, message: 'Невірне ім’я користувача або пароль' };
    }

    subscribeToCurrentUserDoc() {
        const provider = getBackendProvider();
        if (!provider.isConfigured() || !this.currentUser) return;
        if (this.userUnsubscribe) this.userUnsubscribe();

        const currentUsername = this.currentUser.username.toLowerCase();
        // Mirrors login()'s wasCloudAuthorized guard: without it, a bootstrap account (no
        // backend record yet) would get revoked by this listener seconds after logging in,
        // since the very first update for it is also "doesn't exist".
        let cloudAuthorized = !!this.currentUser.cloudAuthorized;

        this.userUnsubscribe = provider.subscribeCurrentUser(currentUsername, {
            onExists: (cloudData) => {
                console.log(`[AuthManager] Real-time user data update received for '${this.currentUser.username}':`, cloudData);
                cloudAuthorized = true;

                const users = this.getUsers();
                const found = users.find(u => u.username.toLowerCase() === currentUsername);
                if (found) {
                    found.role = cloudData.role || found.role;
                    found.allowedProfiles = cloudData.allowedProfiles || found.allowedProfiles;
                    found.firebaseUid = cloudData.firebaseUid || found.firebaseUid;
                    found.cloudAuthorized = true;
                    fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

                    this.currentUser.role = found.role;
                    this.currentUser.allowedProfiles = found.allowedProfiles;
                    this.currentUser.firebaseUid = found.firebaseUid;
                    this.currentUser.cloudAuthorized = true;
                }
            },
            onMissing: () => {
                if (cloudAuthorized) {
                    console.warn(`[AuthManager] Real-time check: backend record for '${currentUsername}' deleted. Revoking session.`);
                    this.revokeSession(currentUsername, 'Акаунт було видалено або відкликано адміністратором.');
                } else {
                    console.log(`[AuthManager] '${currentUsername}' still has no backend record — not treating as a revoke.`);
                }
            },
            onPermissionDenied: () => {
                if (cloudAuthorized) {
                    console.warn(`[AuthManager] Permission denied on user document '${currentUsername}'. Revoking session.`);
                    this.revokeSession(currentUsername, 'Доступ до акаунту було скасовано адміністратором.');
                }
            },
            onOtherError: (error) => {
                console.warn('[AuthManager] Real-time user document subscription error:', error.message);
            }
        });
    }

    async logout() {
        if (this.userUnsubscribe) {
            this.userUnsubscribe();
            this.userUnsubscribe = null;
        }
        this.currentUser = null;
        this.saveSession();
        try {
            await getBackendProvider().logout();
        } catch (error) {
            console.warn('[AuthManager] Backend sign-out notice:', error.message);
        }
        return { success: true };
    }

    async getUsersSafe() {
        let users = this.getUsers();
        const provider = getBackendProvider();

        // Fetch team users from the backend to keep multi-PC admin lists in sync
        if (provider.isConfigured()) {
            try {
                const cloudUsers = await provider.listTeamUsers();
                let updated = false;
                cloudUsers.forEach(cloudUser => {
                    if (!cloudUser || !cloudUser.username) return;
                    // Never persist another user's password hash to THIS device's disk.
                    // Password verifiers are never downloaded from the backend. A device
                    // keeps only its own local scrypt verifier after a successful login.
                    const { passwordHash: _cloudPasswordHash, ...cloudUserSafe } = cloudUser;
                    const idx = users.findIndex(u => u.username.toLowerCase() === cloudUser.username.toLowerCase());
                    if (idx !== -1) {
                        const localHash = users[idx].passwordHash;
                        users[idx] = { ...users[idx], ...cloudUserSafe };
                        if (localHash) {
                            users[idx].passwordHash = localHash;
                        }
                    } else {
                        users.push(cloudUserSafe);
                    }
                    updated = true;
                });
                if (updated) {
                    fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
                }
            } catch (err) {
                console.warn('[AuthManager] Could not fetch team users from the backend:', err.message);
            }
        }

        return users.map(u => {
            const { passwordHash, password, firebaseAuthSecret, ...safe } = u;
            return safe;
        });
    }

    async deleteUser(username) {
        let users = this.getUsers();
        const target = users.find(u => u.username.toLowerCase() === username.toLowerCase());

        if (username.toLowerCase() === 'admin' || (target && target.role === 'admin')) {
            throw new Error('Неможливо видалити користувача з роллю адміністратора.');
        }

        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            try {
                await provider.deleteTeamUser(username);
            } catch (err) {
                throw new Error(`Не вдалося видалити користувача в захищеному cloud-сервісі: ${err.message}`);
            }
            users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
            fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
            return true;
        }

        users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
        return true;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    canAccessProfile(profileId) {
        if (!this.currentUser) return false;
        if (this.currentUser.role === 'admin' || (this.currentUser.allowedProfiles && this.currentUser.allowedProfiles.includes('*'))) {
            return true;
        }
        return Array.isArray(this.currentUser.allowedProfiles) && this.currentUser.allowedProfiles.includes(profileId);
    }
}

module.exports = AuthManager;
