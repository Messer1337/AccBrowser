const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword } = require('firebase/auth');
const { doc, deleteDoc, setDoc, getDocs, collection } = require('firebase/firestore');
const { getAuthInstance, getSecondaryAuthInstance, getDb, isFirebaseConfigured } = require('../config/firebase');

// The Firebase Auth password is derived (not random) from the user's local passwordHash,
// so ANY machine that knows the correct real password computes the exact same Firebase
// credential — this is what lets the same team account log in from multiple computers.
// (An earlier version generated a random secret per machine instead; since that secret was
// never synced, only the first machine that ever logged in could authenticate — every other
// computer silently failed forever. That's why cross-device sync looked broken.)
function toFirebaseEmail(username) {
    return `${encodeURIComponent(username.toLowerCase())}@oasis-browser.local`;
}

function deriveFirebaseAuthPassword(passwordHash) {
    return crypto.createHash('sha256').update(`${passwordHash}:oasis-firebase-pepper`).digest('hex');
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
                        await this.syncFirebaseAuth(found.username, found.passwordHash);
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

    // Best-effort: signs into (or provisions) this user's Firebase Auth identity so that
    // Firestore security rules can see a real request.auth.uid for them. Never blocks or
    // fails local login — if Firebase is unreachable/misconfigured, the app just falls back
    // to local-only storage as before.
    async syncFirebaseAuth(username, passwordHash) {
        if (!isFirebaseConfigured() || !passwordHash) return;
        const auth = getAuthInstance();
        const secondaryAuth = getSecondaryAuthInstance();
        if (!auth || !secondaryAuth) return;

        const email = toFirebaseEmail(username);
        const derivedPassword = deriveFirebaseAuthPassword(passwordHash);
        let credential = null;

        try {
            credential = await signInWithEmailAndPassword(auth, email, derivedPassword);
        } catch (err) {
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
                try {
                    await createUserWithEmailAndPassword(secondaryAuth, email, derivedPassword);
                    await signOut(secondaryAuth);
                    credential = await signInWithEmailAndPassword(auth, email, derivedPassword);
                } catch (provisionErr) {
                    if (provisionErr.code === 'auth/email-already-in-use') {
                        console.warn(`[AuthManager] Firebase Auth account for '${username}' exists with a different password (likely a leftover account from before this fix, or the local password was changed on another device). Delete the account "${email}" in Firebase Console -> Authentication and log in again to recreate it.`);
                    } else {
                        console.warn('[AuthManager] Firebase Auth provisioning failed:', provisionErr.message);
                    }
                }
            } else {
                console.warn('[AuthManager] Firebase Auth sign-in failed:', err.message);
            }
        }

        // Persist the real Firebase Auth uid so an admin can later revoke it (see deleteUser)
        if (credential && credential.user) {
            this.persistFirebaseUid(username, credential.user.uid);
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

    async saveUser(user) {
        const users = this.getUsers();
        const idx = users.findIndex(u => u.username.toLowerCase() === user.username.toLowerCase());
        
        let userData = { ...user };
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
        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

        // Sync team user account to Cloud Firestore
        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                const cleanUserDoc = {
                    username: userData.username,
                    role: userData.role || 'user',
                    allowedProfiles: userData.allowedProfiles || [],
                    passwordHash: userData.passwordHash || '',
                    updatedAt: Date.now()
                };
                await setDoc(doc(db, 'teamUsers', userData.username.toLowerCase()), cleanUserDoc);
                console.log(`[AuthManager] Team user '${userData.username}' synced to Cloud Firestore.`);
            } catch (err) {
                console.warn(`[AuthManager] Could not sync team user '${userData.username}' to Firestore:`, err.message);
            }
        }
        return true;
    }

    async changePassword(username, newPassword) {
        const users = this.getUsers();
        const user = users.find(u => u.username === username);
        if (!user) return { success: false, message: 'Користувача не знайдено' };

        const newHash = this.hashPassword(newPassword);
        user.passwordHash = newHash;
        user.mustChangePassword = false;
        delete user.password;

        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

        if (this.currentUser && this.currentUser.username === username) {
            this.currentUser.mustChangePassword = false;
        }

        // The Firebase Auth password is derived from passwordHash, so it must be rotated
        // to match — we can only do this for our own currently-signed-in session (Firebase
        // Auth has no client-side way to change another user's password without them).
        if (isFirebaseConfigured() && this.currentUser && this.currentUser.username === username) {
            const auth = getAuthInstance();
            if (auth && auth.currentUser) {
                try {
                    await updatePassword(auth.currentUser, deriveFirebaseAuthPassword(newHash));
                } catch (err) {
                    console.warn(`[AuthManager] Could not rotate Firebase Auth password for '${username}':`, err.message);
                }
            }
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
            await this.syncFirebaseAuth(found.username, found.passwordHash || hash);
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

    async getUsersSafe() {
        let users = this.getUsers();

        // Fetch team users from Cloud Firestore to keep multi-PC admin lists in sync
        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                const snapshot = await getDocs(collection(db, 'teamUsers'));
                let updated = false;
                snapshot.forEach(docSnap => {
                    const cloudUser = docSnap.data();
                    if (cloudUser && cloudUser.username) {
                        const idx = users.findIndex(u => u.username.toLowerCase() === cloudUser.username.toLowerCase());
                        if (idx !== -1) {
                            users[idx] = { ...users[idx], ...cloudUser };
                        } else {
                            users.push(cloudUser);
                        }
                        updated = true;
                    }
                });
                if (updated) {
                    fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
                }
            } catch (err) {
                console.warn('[AuthManager] Could not fetch team users from Cloud Firestore:', err.message);
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

        users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                // 1. Delete teamUsers cloud document
                await deleteDoc(doc(db, 'teamUsers', username.toLowerCase()));

                // 2. Revoke Firestore auth if UID present
                if (target && target.firebaseUid) {
                    await deleteDoc(doc(db, 'authorizedUsers', target.firebaseUid));
                    console.log(`[AuthManager] Revoked Firestore authorization for '${username}' (UID: ${target.firebaseUid}).`);
                }
            } catch (err) {
                console.warn(`[AuthManager] Could not revoke Cloud Firestore user '${username}':`, err.message);
            }
        }
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
