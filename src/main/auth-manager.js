const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = require('firebase/auth');
const { getAuthInstance, getSecondaryAuthInstance, isFirebaseConfigured } = require('../config/firebase');

// Firebase Auth identity is deliberately decoupled from the user's chosen local password:
// it's a random secret generated once and stored locally, so changing the local password
// (self-service or admin reset) never desyncs the cloud credential.
function toFirebaseEmail(username) {
    return `${encodeURIComponent(username.toLowerCase())}@oasis-browser.local`;
}

class AuthManager {
    constructor(userDataPath) {
        this.userDataPath = userDataPath;
        this.usersFile = path.join(userDataPath, 'users.json');
        this.sessionFile = path.join(userDataPath, 'session.json');
        this.currentUser = null;
        this.initDefaultUsers();
    }

    hashPassword(password) {
        return crypto.createHash('sha256').update(password).digest('hex');
    }

    initDefaultUsers() {
        if (!fs.existsSync(this.usersFile)) {
            const defaultUsers = [
                {
                    username: 'admin',
                    passwordHash: this.hashPassword('admin'),
                    role: 'admin',
                    mustChangePassword: true,
                    allowedProfiles: ['*']
                },
                {
                    username: 'user1',
                    passwordHash: this.hashPassword('user'),
                    role: 'user',
                    mustChangePassword: false,
                    allowedProfiles: ['chatgpt_profile']
                }
            ];
            fs.writeJsonSync(this.usersFile, defaultUsers, { spaces: 2 });
        } else {
            // Migration check: If old users.json has plain passwords, hash them
            try {
                const users = fs.readJsonSync(this.usersFile);
                let updated = false;
                for (const u of users) {
                    if (u.password && !u.passwordHash) {
                        u.passwordHash = this.hashPassword(u.password);
                        delete u.password;
                        if (u.username === 'admin' && u.password === 'admin') {
                            u.mustChangePassword = true;
                        }
                        updated = true;
                    }
                }
                if (updated) {
                    fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
                }
            } catch (e) {}
        }
    }

    async restoreSession() {
        try {
            if (fs.existsSync(this.sessionFile)) {
                const sessionData = fs.readJsonSync(this.sessionFile);
                if (sessionData && sessionData.username) {
                    const users = this.getUsers();
                    const found = users.find(u => u.username === sessionData.username);
                    if (found) {
                        const { passwordHash, firebaseAuthSecret, ...safeUser } = found;
                        this.currentUser = safeUser;
                        console.log(`[AuthManager] Restoring active session for user: ${this.currentUser.username}`);
                        await this.syncFirebaseAuth(found.username);
                    }
                }
            }
        } catch (e) {
            console.warn('[AuthManager] Session restore error:', e.message);
        }
    }

    saveSession() {
        try {
            if (this.currentUser) {
                fs.writeJsonSync(this.sessionFile, { username: this.currentUser.username }, { spaces: 2 });
            } else {
                fs.removeSync(this.sessionFile);
            }
        } catch (e) {}
    }

    getUsers() {
        try {
            return fs.readJsonSync(this.usersFile);
        } catch (e) {
            return [];
        }
    }

    // Firebase Auth password is independent of the human-chosen local password (see toFirebaseEmail above).
    // Generated once, persisted locally, never rotated on local password change.
    getOrCreateFirebaseSecret(username) {
        const users = this.getUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user) return null;
        if (user.firebaseAuthSecret) return user.firebaseAuthSecret;

        user.firebaseAuthSecret = crypto.randomBytes(32).toString('hex');
        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
        return user.firebaseAuthSecret;
    }

    // Best-effort: signs into (or provisions) this user's Firebase Auth identity so that
    // Firestore security rules can see a real request.auth.uid for them. Never blocks or
    // fails local login — if Firebase is unreachable/misconfigured, the app just falls back
    // to local-only storage as before.
    async syncFirebaseAuth(username) {
        if (!isFirebaseConfigured()) return;
        const auth = getAuthInstance();
        const secondaryAuth = getSecondaryAuthInstance();
        if (!auth || !secondaryAuth) return;

        const secret = this.getOrCreateFirebaseSecret(username);
        if (!secret) return;
        const email = toFirebaseEmail(username);

        try {
            await signInWithEmailAndPassword(auth, email, secret);
        } catch (err) {
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
                try {
                    await createUserWithEmailAndPassword(secondaryAuth, email, secret);
                    await signOut(secondaryAuth);
                    await signInWithEmailAndPassword(auth, email, secret);
                } catch (provisionErr) {
                    console.warn('[AuthManager] Firebase Auth provisioning failed:', provisionErr.message);
                }
            } else {
                console.warn('[AuthManager] Firebase Auth sign-in failed:', err.message);
            }
        }
    }

    saveUser(user) {
        const users = this.getUsers();
        const idx = users.findIndex(u => u.username === user.username);
        
        let userData = { ...user };
        if (userData.password) {
            userData.passwordHash = this.hashPassword(userData.password);
            delete userData.password;
        }

        if (idx !== -1) {
            users[idx] = { ...users[idx], ...userData };
        } else {
            users.push(userData);
        }
        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
        return true;
    }

    changePassword(username, newPassword) {
        const users = this.getUsers();
        const user = users.find(u => u.username === username);
        if (!user) return { success: false, message: 'Користувача не знайдено' };

        user.passwordHash = this.hashPassword(newPassword);
        user.mustChangePassword = false;
        delete user.password;
        
        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

        if (this.currentUser && this.currentUser.username === username) {
            this.currentUser.mustChangePassword = false;
        }
        return { success: true };
    }

    async login(username, password) {
        const users = this.getUsers();
        const hash = this.hashPassword(password);
        const found = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase() && (u.passwordHash === hash || u.password === password));

        if (found) {
            const { passwordHash, password, firebaseAuthSecret, ...safeUser } = found;
            this.currentUser = safeUser;
            this.saveSession();
            await this.syncFirebaseAuth(found.username);
            return { success: true, user: safeUser };
        }
        return { success: false, message: 'Невірне ім’я користувача або пароль' };
    }

    async logout() {
        this.currentUser = null;
        this.saveSession();
        const auth = getAuthInstance();
        if (auth) {
            try { await signOut(auth); } catch (e) {}
        }
        return { success: true };
    }

    getUsersSafe() {
        const users = this.getUsers();
        return users.map(u => {
            const { passwordHash, password, firebaseAuthSecret, ...safe } = u;
            return safe;
        });
    }

    deleteUser(username) {
        if (username === 'admin') {
            throw new Error('Неможливо видалити головного адміністратора.');
        }
        let users = this.getUsers();
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
