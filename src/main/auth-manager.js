const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword, deleteUser } = require('firebase/auth');
const { doc, deleteDoc, setDoc, getDoc, getDocs, collection, onSnapshot } = require('firebase/firestore');
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
        fs.ensureDirSync(userDataPath);
        this.usersFile = path.join(userDataPath, 'users.json');
        this.sessionFile = path.join(userDataPath, 'session.json');
        this.currentUser = null;
        this.userUnsubscribe = null;
        this.onForceLogoutCallback = null;
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
        } catch (e) {}

        await this._destroyOwnFirebaseAuthAccount();
        await this.logout();

        if (typeof this.onForceLogoutCallback === 'function') {
            this.onForceLogoutCallback({ username, reason });
        }
    }

    // Best-effort: deletes this device's own Firebase Auth identity for the account that
    // just got revoked. Only the account itself can delete it client-side (no Admin SDK/
    // backend here) — but when this runs (device online + signed in at revoke time), it
    // means a future admin re-add of the same username with a NEW password won't collide
    // with a stale auth/email-already-in-use account nobody can ever sign into again.
    async _destroyOwnFirebaseAuthAccount() {
        if (!isFirebaseConfigured()) return;
        const auth = getAuthInstance();
        if (!auth || !auth.currentUser) return;
        try {
            await deleteUser(auth.currentUser);
            console.log('[AuthManager] Deleted own Firebase Auth account after revocation.');
        } catch (e) {
            console.warn('[AuthManager] Could not delete own Firebase Auth account, signing out instead:', e.message);
            try { await signOut(auth); } catch (e2) {}
        }
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
        // Session restoring is disabled to force a password prompt on every start.
        return;
    }

    saveSession() {
        // Session saving is disabled to force a password prompt on every start.
        try {
            if (fs.existsSync(this.sessionFile)) {
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
                        // The account exists with a DIFFERENT password than the one just derived
                        // from this device's local hash (the identical sign-in already failed
                        // above — retrying it here would just fail again the same way). Either
                        // this device's local password is stale, or it's a leftover account from
                        // a deleted-then-recreated user who was offline when revoked. An admin
                        // resetting this user's password via "Manage Users" fixes the former
                        // (see saveUser); the latter needs the account deleted manually.
                        console.warn(`[AuthManager] Firebase Auth account for '${username}' exists with a different password than this device knows. Ask an admin to reset their password, or delete "${email}" in Firebase Console -> Authentication.`);
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
        // Captured before the merge below overwrites it — lets us tell "resetting an existing
        // user's password" (we know their old derived password, so we can rotate it) apart from
        // "re-adding a previously deleted username" (we don't, so we can't).
        const previousPasswordHash = idx !== -1 ? users[idx].passwordHash : null;

        let userData = { ...user };
        const plainPassword = userData.password;
        
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

        // Sync team user account to Cloud Firestore & Provision Firebase Auth
        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                
                // If a password is provided (creating a new user or resetting their password), provision/update Firebase Auth
                if (plainPassword) {
                    const secondaryAuth = getSecondaryAuthInstance();
                    if (secondaryAuth) {
                        const email = toFirebaseEmail(userData.username);
                        const derivedPassword = deriveFirebaseAuthPassword(userData.passwordHash);
                        let firebaseUid = userData.firebaseUid;
                        
                        try {
                            const credential = await createUserWithEmailAndPassword(secondaryAuth, email, derivedPassword);
                            await signOut(secondaryAuth);
                            firebaseUid = credential.user.uid;
                            console.log(`[AuthManager] Provisioned Firebase Auth account for '${userData.username}' (UID: ${firebaseUid})`);
                        } catch (authErr) {
                            if (authErr.code === 'auth/email-already-in-use') {
                                if (previousPasswordHash) {
                                    // Password reset for an EXISTING user (not a fresh re-add): we
                                    // know their previous derived password, so sign in as them and
                                    // rotate it — the only client-side way to change another user's
                                    // Firebase Auth password without an Admin SDK/backend.
                                    console.log(`[AuthManager] Rotating Firebase Auth password for existing user '${userData.username}'...`);
                                    try {
                                        const oldDerivedPassword = deriveFirebaseAuthPassword(previousPasswordHash);
                                        const userCred = await signInWithEmailAndPassword(secondaryAuth, email, oldDerivedPassword);
                                        await updatePassword(userCred.user, derivedPassword);
                                        await signOut(secondaryAuth);
                                        firebaseUid = userCred.user.uid;
                                        console.log(`[AuthManager] Rotated Firebase Auth password for '${userData.username}' (UID: ${firebaseUid})`);
                                    } catch (rotateErr) {
                                        console.warn(`[AuthManager] Could not rotate Firebase Auth password for '${userData.username}' (their previous local password may already be stale):`, rotateErr.message);
                                    }
                                } else {
                                    // No previous local password on record — this is a re-add of a
                                    // previously deleted username. If they were online when revoked,
                                    // revokeSession() already deleted their old Firebase Auth account
                                    // and this branch would never be reached. If they were offline,
                                    // the old account is unrecoverable from the client and needs
                                    // manual cleanup.
                                    console.warn(`[AuthManager] Firebase Auth account for '${userData.username}' already exists with an unknown password (likely a re-added user whose old account survived because their device was offline when revoked). Delete "${email}" in Firebase Console -> Authentication to let them log in again.`);
                                }
                            } else {
                                console.warn('[AuthManager] Auth provisioning notice:', authErr.message);
                            }
                        }
                        
                        if (firebaseUid) {
                            userData.firebaseUid = firebaseUid;
                            
                            // Save updated user with UID locally
                            const currentUsers = this.getUsers();
                            const uIdx = currentUsers.findIndex(u => u.username.toLowerCase() === userData.username.toLowerCase());
                            if (uIdx !== -1) {
                                currentUsers[uIdx].firebaseUid = firebaseUid;
                                fs.writeJsonSync(this.usersFile, currentUsers, { spaces: 2 });
                            }
                            
                            // Authorize this user UID in Firestore authorizedUsers
                            const authUserRef = doc(db, 'authorizedUsers', firebaseUid);
                            await setDoc(authUserRef, {
                                username: userData.username.toLowerCase(),
                                role: userData.role || 'user'
                            });
                            console.log(`[AuthManager] Authorized UID '${firebaseUid}' for '${userData.username.toLowerCase()}' in Firestore.`);
                        }
                    }
                }

                const cleanUserDoc = {
                    username: userData.username,
                    role: userData.role || 'user',
                    allowedProfiles: userData.allowedProfiles || [],
                    passwordHash: userData.passwordHash || '',
                    firebaseUid: userData.firebaseUid || null,
                    updatedAt: Date.now()
                };
                await setDoc(doc(db, 'teamUsers', userData.username.toLowerCase()), cleanUserDoc);
                console.log(`[AuthManager] Team user '${userData.username}' synced to Cloud Firestore.`);

                // Mark this account as cloud-authorized so a future missing/denied teamUsers
                // read can be told apart from "never provisioned yet" (see login()).
                const syncedUsers = this.getUsers();
                const syncedIdx = syncedUsers.findIndex(u => u.username.toLowerCase() === userData.username.toLowerCase());
                if (syncedIdx !== -1) {
                    syncedUsers[syncedIdx].cloudAuthorized = true;
                    fs.writeJsonSync(this.usersFile, syncedUsers, { spaces: 2 });
                }
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
        user.updatedAt = Date.now();
        delete user.password;

        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

        if (this.currentUser && this.currentUser.username === username) {
            this.currentUser.mustChangePassword = false;
        }

        if (isFirebaseConfigured()) {
            // 1. Sync updated passwordHash to Cloud Firestore teamUsers document
            try {
                const db = getDb();
                await setDoc(doc(db, 'teamUsers', username.toLowerCase()), {
                    passwordHash: newHash,
                    updatedAt: Date.now()
                }, { merge: true });
                console.log(`[AuthManager] Password hash synced to Cloud Firestore for '${username}'.`);
            } catch (cloudErr) {
                console.warn(`[AuthManager] Could not sync updated password hash to Firestore for '${username}':`, cloudErr.message);
            }

            // 2. Rotate Firebase Auth password if currently logged in
            if (this.currentUser && this.currentUser.username === username) {
                const auth = getAuthInstance();
                if (auth && auth.currentUser) {
                    try {
                        await updatePassword(auth.currentUser, deriveFirebaseAuthPassword(newHash));
                    } catch (err) {
                        console.warn(`[AuthManager] Could not rotate Firebase Auth password for '${username}':`, err.message);
                    }
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
            // Captured BEFORE this login attempt can mutate it: tells a real revoke (doc
            // existed before, gone now) apart from "never synced to the cloud yet" (e.g. the
            // seed admin before anyone has done the manual Firebase Console authorization step).
            const wasCloudAuthorized = !!found.cloudAuthorized;
            const { passwordHash, password, firebaseAuthSecret, ...safeUser } = found;
            this.currentUser = safeUser;
            this.saveSession();
            await this.syncFirebaseAuth(found.username, found.passwordHash || hash);

            // Sync user role and allowedProfiles from Firestore on successful login
            if (isFirebaseConfigured()) {
                try {
                    const db = getDb();
                    const userDocSnap = await getDoc(doc(db, 'teamUsers', username.toLowerCase()));
                    if (userDocSnap.exists()) {
                        const cloudData = userDocSnap.data();
                        found.role = cloudData.role || found.role;
                        found.allowedProfiles = cloudData.allowedProfiles || found.allowedProfiles;
                        found.firebaseUid = cloudData.firebaseUid || found.firebaseUid;
                        found.cloudAuthorized = true;
                        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });

                        this.currentUser.role = found.role;
                        this.currentUser.allowedProfiles = found.allowedProfiles;
                        this.currentUser.firebaseUid = found.firebaseUid;
                        this.currentUser.cloudAuthorized = true;
                        console.log(`[AuthManager] Synced role and profiles for '${username}' from Cloud Firestore.`);
                    } else if (wasCloudAuthorized) {
                        console.warn(`[AuthManager] Login rejected: cloud document for '${username}' no longer exists (revoked).`);
                        const remaining = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
                        fs.writeJsonSync(this.usersFile, remaining, { spaces: 2 });
                        this.currentUser = null;
                        this.saveSession();
                        await this._destroyOwnFirebaseAuthAccount();
                        return { success: false, message: 'Цей акаунт було видалено або відкликано адміністратором.' };
                    } else {
                        console.log(`[AuthManager] '${username}' has no Cloud Firestore record yet — continuing with local-only login.`);
                    }
                } catch (dbErr) {
                    console.warn('[AuthManager] Could not sync user role/profiles from Firestore after login:', dbErr.message);
                    const isPermissionError = dbErr.code === 'permission-denied' || (dbErr.message && dbErr.message.includes('permission'));
                    if (isPermissionError && wasCloudAuthorized) {
                        console.warn(`[AuthManager] Login rejected: permission denied for '${username}' (revoked).`);
                        const remaining = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
                        fs.writeJsonSync(this.usersFile, remaining, { spaces: 2 });
                        this.currentUser = null;
                        this.saveSession();
                        await this._destroyOwnFirebaseAuthAccount();
                        return { success: false, message: 'Цей акаунт було видалено або відкликано адміністратором.' };
                    }
                }
            }

            this.subscribeToCurrentUserDoc();
            return { success: true, user: this.currentUser };
        }

        // Multi-device fallback: if local password check fails, verify with Firebase Auth
        if (isFirebaseConfigured() && username) {
            const email = toFirebaseEmail(username);
            const derivedPassword = deriveFirebaseAuthPassword(hash);
            const auth = getAuthInstance();
            if (auth) {
                try {
                    const credential = await signInWithEmailAndPassword(auth, email, derivedPassword);
                    if (credential && credential.user) {
                        console.log(`[AuthManager] Multi-device password sync: updating local password for '${username}'`);
                        
                        let localUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());
                        let role = username.toLowerCase() === 'admin' ? 'admin' : 'user';
                        let allowedProfiles = username.toLowerCase() === 'admin' ? ['*'] : [];
                        // Same distinction as the local-match branch above: only a device that
                        // previously confirmed this account's teamUsers doc can treat it going
                        // missing as a real revoke, not just "not synced to the cloud yet".
                        let cloudAuthorized = !!(localUser && localUser.cloudAuthorized);

                        try {
                            const db = getDb();
                            const userDocSnap = await getDoc(doc(db, 'teamUsers', username.toLowerCase()));
                            if (userDocSnap.exists()) {
                                const cloudData = userDocSnap.data();
                                role = cloudData.role || role;
                                allowedProfiles = cloudData.allowedProfiles || allowedProfiles;
                                cloudAuthorized = true;
                            } else if (cloudAuthorized) {
                                console.warn(`[AuthManager] Fallback login rejected: cloud document for '${username}' no longer exists (revoked).`);
                                await this._destroyOwnFirebaseAuthAccount();
                                return { success: false, message: 'Цей акаунт було видалено або відкликано адміністратором.' };
                            } else {
                                console.log(`[AuthManager] '${username}' has no Cloud Firestore record yet — continuing with local defaults.`);
                            }
                        } catch (dbErr) {
                            console.warn('[AuthManager] Could not fetch user data from Firestore during fallback:', dbErr.message);
                            const isPermissionError = dbErr.code === 'permission-denied' || (dbErr.message && dbErr.message.includes('permission'));
                            if (isPermissionError && cloudAuthorized) {
                                await this._destroyOwnFirebaseAuthAccount();
                                return { success: false, message: 'Цей акаунт було видалено або відкликано адміністратором.' };
                            }
                        }

                        if (!localUser) {
                            localUser = {
                                username: username,
                                role: role,
                                allowedProfiles: allowedProfiles
                            };
                            users.push(localUser);
                        } else {
                            localUser.role = role;
                            localUser.allowedProfiles = allowedProfiles;
                        }

                        localUser.passwordHash = hash;
                        localUser.mustChangePassword = false;
                        localUser.firebaseUid = credential.user.uid;
                        localUser.cloudAuthorized = cloudAuthorized;

                        fs.writeJsonSync(this.usersFile, users, { spaces: 2 });
                        
                        const { passwordHash: ph, password: p, firebaseAuthSecret, ...safeUser } = localUser;
                        this.currentUser = safeUser;
                        this.saveSession();
                        this.subscribeToCurrentUserDoc();
                        return { success: true, user: safeUser };
                    }
                } catch (err) {
                    console.warn('[AuthManager] Firebase Auth fallback sign-in failed:', err.message);
                }
            }
        }

        return { success: false, message: 'Невірне ім’я користувача або пароль' };
    }

    subscribeToCurrentUserDoc() {
        if (!isFirebaseConfigured() || !this.currentUser) return;
        if (this.userUnsubscribe) this.userUnsubscribe();

        const currentUsername = this.currentUser.username.toLowerCase();
        // Mirrors login()'s wasCloudAuthorized guard: without it, a bootstrap account (no
        // teamUsers doc yet) would get revoked by this listener seconds after logging in,
        // since the very first snapshot for it is also "doesn't exist".
        let cloudAuthorized = !!this.currentUser.cloudAuthorized;

        try {
            const db = getDb();
            const userDocRef = doc(db, 'teamUsers', currentUsername);
            this.userUnsubscribe = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    const cloudData = docSnap.data();
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
                } else if (cloudAuthorized) {
                    console.warn(`[AuthManager] Real-time check: cloud document for '${currentUsername}' deleted. Revoking session.`);
                    this.revokeSession(currentUsername, 'Акаунт було видалено або відкликано адміністратором.');
                } else {
                    console.log(`[AuthManager] '${currentUsername}' still has no Cloud Firestore record — not treating as a revoke.`);
                }
            }, (error) => {
                console.warn('[AuthManager] Real-time user document subscription error:', error.message);
                if (cloudAuthorized && (error.code === 'permission-denied' || (error.message && error.message.includes('permission')))) {
                    console.warn(`[AuthManager] Permission denied on user document '${currentUsername}'. Revoking session.`);
                    this.revokeSession(currentUsername, 'Доступ до акаунту було скасовано адміністратором.');
                }
            });
        } catch (e) {
            console.warn('[AuthManager] Failed to establish real-time user document subscription:', e.message);
        }
    }

    async logout() {
        if (this.userUnsubscribe) {
            this.userUnsubscribe();
            this.userUnsubscribe = null;
        }
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
                            const localHash = users[idx].passwordHash;
                            const localUpdatedAt = users[idx].updatedAt || 0;
                            const cloudUpdatedAt = cloudUser.updatedAt || 0;

                            users[idx] = { ...users[idx], ...cloudUser };

                            // Protect newer local password hash from being overwritten by older cloud hash
                            if (localHash && cloudUpdatedAt <= localUpdatedAt) {
                                users[idx].passwordHash = localHash;
                            }
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
