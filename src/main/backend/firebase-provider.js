const crypto = require('crypto');
const {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    updatePassword
} = require('firebase/auth');
const {
    doc, setDoc, getDoc, getDocs, deleteDoc, addDoc, collection,
    onSnapshot, deleteField, query, orderBy, limit, runTransaction
} = require('firebase/firestore');
const { httpsCallable } = require('firebase/functions');
const {
    getAuthInstance, getSecondaryAuthInstance, getDb, getFunctionsInstance,
    isFirebaseConfigured, getFirebaseMode
} = require('../../config/firebase');
const { ERROR_CODES, backendError } = require('./provider');

// Firebase credentials are deterministically derived from the password entered at login.
// Local password verifiers are deliberately separate: they use scrypt and are never sent
// to Firestore or used as Firebase credential material.
function toFirebaseEmail(username) {
    return `${encodeURIComponent(username.toLowerCase())}@oasis-browser.local`;
}

function deriveFirebaseAuthPassword(password) {
    const legacyDigest = crypto.createHash('sha256').update(password).digest('hex');
    return crypto.createHash('sha256').update(`${legacyDigest}:oasis-firebase-pepper`).digest('hex');
}

function isPermissionError(error) {
    return error.code === 'permission-denied' || (error.message && error.message.includes('permission'));
}

class FirebaseProvider {
    isConfigured() {
        return isFirebaseConfigured();
    }

    getMode() {
        return getFirebaseMode();
    }

    // Signs into (or provisions) this user's Firebase Auth identity, then fetches their
    // teamUsers record. Never throws for "could not authenticate this attempt" (offline,
    // stale local password, not yet provisioned) — resolves { authenticated: false } and
    // the caller keeps using cached local data. Once authentication itself succeeds, a
    // missing/inaccessible teamUsers record throws so the caller can apply its own
    // revoke-vs-not-yet-synced decision.
    async login(username, password) {
        if (!isFirebaseConfigured() || !password) return { authenticated: false };
        const auth = getAuthInstance();
        const secondaryAuth = getSecondaryAuthInstance();
        if (!auth || !secondaryAuth) return { authenticated: false };

        const email = toFirebaseEmail(username);
        const derivedPassword = deriveFirebaseAuthPassword(password);
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
                        // from this device's local hash. Either this device's local password is
                        // stale, or it's a leftover account from a deleted-then-recreated user who
                        // was offline when revoked. An admin resetting this user's password via
                        // "Manage Users" fixes the former; the latter needs manual cleanup.
                        console.warn(`[FirebaseProvider] Firebase Auth account for '${username}' exists with a different password than this device knows. Ask an admin to reset their password, or delete "${email}" in Firebase Console -> Authentication.`);
                    } else {
                        console.warn('[FirebaseProvider] Firebase Auth provisioning failed:', provisionErr.message);
                    }
                    return { authenticated: false };
                }
            } else {
                console.warn('[FirebaseProvider] Firebase Auth sign-in failed:', err.message);
                return { authenticated: false };
            }
        }

        if (!credential || !credential.user) return { authenticated: false };
        const uid = credential.user.uid;

        try {
            const db = getDb();
            const userDocSnap = await getDoc(doc(db, 'teamUsers', username.toLowerCase()));
            if (!userDocSnap.exists()) {
                const error = backendError(ERROR_CODES.NOT_FOUND, `No teamUsers record for '${username}'`);
                error.uid = uid;
                throw error;
            }
            const cloudData = userDocSnap.data();
            return {
                authenticated: true,
                uid,
                role: cloudData.role,
                allowedProfiles: cloudData.allowedProfiles,
                firebaseUid: cloudData.firebaseUid || uid
            };
        } catch (err) {
            if (err.code === ERROR_CODES.NOT_FOUND) throw err;
            const wrapped = backendError(isPermissionError(err) ? ERROR_CODES.PERMISSION_DENIED : ERROR_CODES.UNAVAILABLE, err.message);
            wrapped.uid = uid;
            throw wrapped;
        }
    }

    async logout() {
        const auth = getAuthInstance();
        if (!auth || !auth.currentUser) return;
        try {
            await signOut(auth);
        } catch (error) {
            console.warn('[FirebaseProvider] Sign-out notice:', error.message);
        }
    }

    async changeOwnPassword(newPassword) {
        const auth = getAuthInstance();
        if (!auth || !auth.currentUser) return;
        try {
            await updatePassword(auth.currentUser, deriveFirebaseAuthPassword(newPassword));
        } catch (err) {
            console.warn('[FirebaseProvider] Could not rotate Firebase Auth password:', err.message);
        }
    }

    // Live listener mirroring onSnapshot(teamUsers/{username}). The caller owns the
    // "was this ever cloud-authorized before" bookkeeping needed to tell a real revoke
    // apart from an account that has simply never synced yet.
    subscribeCurrentUser(username, { onExists, onMissing, onPermissionDenied, onOtherError }) {
        const auth = getAuthInstance();
        if (!auth || !auth.currentUser) return () => {};
        try {
            const db = getDb();
            const userDocRef = doc(db, 'teamUsers', username.toLowerCase());
            const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) onExists(docSnap.data());
                else onMissing();
            }, (error) => {
                if (isPermissionError(error)) onPermissionDenied(error);
                else onOtherError(error);
            });
            return unsubscribe;
        } catch (e) {
            console.warn('[FirebaseProvider] Failed to establish real-time user document subscription:', e.message);
            return () => {};
        }
    }

    async upsertTeamUser({ username, role, allowedProfiles, password }) {
        const functions = getFunctionsInstance();
        if (!functions) throw backendError(ERROR_CODES.UNAVAILABLE, 'Cloud Functions не ініціалізовано.');
        const response = await httpsCallable(functions, 'upsertTeamUser')({
            username, role, allowedProfiles, ...(password ? { password } : {})
        });
        return { uid: response.data.firebaseUid };
    }

    async deleteTeamUser(username) {
        const functions = getFunctionsInstance();
        if (!functions) throw backendError(ERROR_CODES.UNAVAILABLE, 'Cloud Functions не ініціалізовано.');
        await httpsCallable(functions, 'deleteTeamUser')({ username });
    }

    // Returns the raw teamUsers records (may still contain a legacy passwordHash field on
    // not-yet-migrated documents — the caller is responsible for never persisting that
    // locally). Runs the one-time ACL-migration side effect (populating authorizedUsers,
    // stripping legacy passwordHash) as part of the same pass, exactly as before.
    async listTeamUsers() {
        const db = getDb();
        const snapshot = await getDocs(collection(db, 'teamUsers'));
        const records = [];
        const aclMigrations = [];
        snapshot.forEach(docSnap => {
            const cloudUser = docSnap.data();
            if (!cloudUser || !cloudUser.username) return;
            records.push(cloudUser);
            if (cloudUser.firebaseUid) {
                aclMigrations.push(setDoc(doc(db, 'authorizedUsers', cloudUser.firebaseUid), {
                    username: cloudUser.username.toLowerCase(),
                    role: cloudUser.role || 'user',
                    allowedProfiles: cloudUser.allowedProfiles || []
                }, { merge: true }));
                aclMigrations.push(setDoc(doc(db, 'teamUsers', cloudUser.username.toLowerCase()), {
                    passwordHash: deleteField()
                }, { merge: true }));
            }
        });
        await Promise.all(aclMigrations);
        return records;
    }

    async getProfile(id) {
        const db = getDb();
        const docSnap = await getDoc(doc(db, 'profiles', id));
        return docSnap.exists() ? docSnap.data() : null;
    }

    async listProfiles() {
        const db = getDb();
        const querySnapshot = await getDocs(collection(db, 'profiles'));
        const results = [];
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data) results.push(data);
        });
        return results;
    }

    async saveProfileFull(id, cleanData, expectedRevision, currentUser) {
        const db = getDb();
        const profileRef = doc(db, 'profiles', id);
        return runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(profileRef);
            const currentRevision = snapshot.exists() ? Number(snapshot.get('revision') || 0) : 0;
            if (snapshot.exists() && expectedRevision !== currentRevision) {
                throw backendError(ERROR_CODES.FAILED_PRECONDITION, 'Конфлікт синхронізації: профіль змінився на іншому пристрої. Оновіть дані перед повторним збереженням.');
            }
            const revision = currentRevision + 1;
            const updatedAt = Date.now();
            const cloudData = { ...cleanData, revision, updatedBy: currentUser, updatedAt };
            transaction.set(profileRef, cloudData, { merge: true });
            return { revision, updatedAt, updatedBy: currentUser };
        });
    }

    async syncProfileSession(id, { deviceId, cookies, expectedRevision }) {
        const functions = getFunctionsInstance();
        if (!functions) throw backendError(ERROR_CODES.UNAVAILABLE, 'Cloud Functions не ініціалізовано.');
        const response = await httpsCallable(functions, 'syncProfileSession')({ profileId: id, deviceId, cookies, expectedRevision });
        return { revision: response.data.revision, updatedAt: response.data.updatedAt, updatedBy: response.data.updatedBy };
    }

    async ensureProfileFingerprint(id, { fingerprint, fingerprintHeaders }) {
        const functions = getFunctionsInstance();
        if (!functions) throw backendError(ERROR_CODES.UNAVAILABLE, 'Cloud Functions не ініціалізовано.');
        const response = await httpsCallable(functions, 'ensureProfileFingerprint')({
            profileId: id, fingerprint, fingerprintHeaders: fingerprintHeaders || {}
        });
        return response.data || null;
    }

    async claimProfileLease(id, deviceId) {
        const functions = getFunctionsInstance();
        if (!functions) throw backendError(ERROR_CODES.UNAVAILABLE, 'Cloud Functions не ініціалізовано.');
        const response = await httpsCallable(functions, 'claimProfileLease')({ profileId: id, deviceId });
        return { activeHolder: response.data.activeHolder || null };
    }

    async heartbeatProfileLease(id, deviceId) {
        const functions = getFunctionsInstance();
        if (!functions) throw backendError(ERROR_CODES.UNAVAILABLE, 'Cloud Functions не ініціалізовано.');
        const response = await httpsCallable(functions, 'heartbeatProfileLease')({ profileId: id, deviceId });
        return { activeHolder: response.data.activeHolder || null };
    }

    async releaseProfileLease(id, deviceId) {
        const functions = getFunctionsInstance();
        if (!functions) throw backendError(ERROR_CODES.UNAVAILABLE, 'Cloud Functions не ініціалізовано.');
        const response = await httpsCallable(functions, 'releaseProfileLease')({ profileId: id, deviceId });
        return { activeHolder: response.data.activeHolder || null };
    }

    async deleteProfile(id) {
        const db = getDb();
        await deleteDoc(doc(db, 'profiles', id));
    }

    subscribeProfile(id, { onUpdate, onError }) {
        try {
            const db = getDb();
            const profileRef = doc(db, 'profiles', id);
            return onSnapshot(profileRef, (docSnap) => {
                if (docSnap.exists()) onUpdate(docSnap.data());
            }, (error) => {
                if (onError) onError(error);
            });
        } catch (e) {
            console.warn(`[FirebaseProvider] Failed to establish live subscription for profile '${id}':`, e.message);
            return () => {};
        }
    }

    // changes: [{ type: 'added'|'modified'|'removed', data }]
    subscribeProfilesCollection({ onDocChanges, onError }) {
        try {
            const db = getDb();
            const profilesRef = collection(db, 'profiles');
            return onSnapshot(profilesRef, (snapshot) => {
                const changes = snapshot.docChanges().map(change => ({ type: change.type, data: change.doc.data() }));
                onDocChanges(changes);
            }, (error) => {
                if (onError) onError(error);
            });
        } catch (e) {
            console.warn('[FirebaseProvider] Failed to establish live profiles collection subscription:', e.message);
            return () => {};
        }
    }

    async logActivity(logEntry) {
        const db = getDb();
        await addDoc(collection(db, 'auditLogs'), logEntry);
    }

    async getAuditLogs(limitCount = 50) {
        const db = getDb();
        const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(limitCount));
        const snapshot = await getDocs(q);
        const logs = [];
        snapshot.forEach(docSnap => logs.push({ id: docSnap.id, ...docSnap.data() }));
        return logs;
    }
}

module.exports = FirebaseProvider;
