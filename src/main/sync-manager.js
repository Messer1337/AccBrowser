const { doc, getDoc, setDoc, deleteDoc, collection, getDocs, addDoc, query, orderBy, limit, onSnapshot } = require('firebase/firestore');
const { getDb, isFirebaseConfigured } = require('../config/firebase');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const crypto = require('crypto');

class SyncManager {
    constructor(userDataPath) {
        this.userDataPath = userDataPath;
        this.localStorageDir = path.join(userDataPath, 'local_db');
        fs.ensureDirSync(this.localStorageDir);
        this.activeSubscriptions = new Map();
        this.cookieHashes = new Map(); // profileId -> string hash
        this.deviceId = this.initDeviceId();
    }

    initDeviceId() {
        const deviceFile = path.join(this.userDataPath, 'device_id.json');
        try {
            if (fs.existsSync(deviceFile)) {
                const data = fs.readJsonSync(deviceFile);
                if (data.deviceId) return data.deviceId;
            }
        } catch (e) {}

        const newId = `${os.userInfo().username}_${crypto.randomUUID().slice(0, 8)}`;
        try {
            fs.writeJsonSync(deviceFile, { deviceId: newId }, { spaces: 2 });
        } catch (e) {}
        return newId;
    }

    // Sanitize profile ID against path traversal
    sanitizeProfileId(id) {
        if (!id || typeof id !== 'string') {
            throw new Error('ID профілю відсутній');
        }
        const cleanId = id.trim();
        if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
            throw new Error('Некоректний ID профілю (дозволені тільки букви, цифри, _ та -)');
        }
        return cleanId;
    }

    // Helper: Calculate hash of cookies array to avoid duplicate sync writes
    getCookiesHash(cookies) {
        if (!Array.isArray(cookies)) return '';
        const cookieString = cookies.map(c => `${c.name}=${c.value};${c.domain};${c.path}`).sort().join('|');
        return crypto.createHash('md5').update(cookieString).digest('hex');
    }

    // Drop non-essential tracking cookies and cap payload size to stay well under Firestore's 1MB doc limit
    trimCookiesForSync(cookies, maxBytes = 700000) {
        if (!Array.isArray(cookies)) return [];

        const TRACKING_PATTERNS = [
            /^_ga/i, /^_gid$/i, /^_gat/i, /^_gcl_/i, /^_fbp$/i, /^_fbc$/i,
            /^_uetsid$/i, /^_uetvid$/i, /^_hj/i, /^_clck$/i, /^_clsk$/i,
            /^NID$/, /^ANID$/, /^DSID$/, /^IDE$/, /^test_cookie$/i,
            /^_pin_unauth$/i, /^_ttp$/i, /^_tt_enable_cookie$/i
        ];

        let trimmed = cookies.filter(c => !TRACKING_PATTERNS.some(rx => rx.test(c.name || '')));

        if (Buffer.byteLength(JSON.stringify(trimmed), 'utf8') <= maxBytes) {
            return trimmed;
        }

        // Still over budget — drop the largest-value cookies first (unlikely to be the actual session token)
        trimmed = [...trimmed].sort((a, b) => (b.value || '').length - (a.value || '').length);
        while (trimmed.length > 0 && Buffer.byteLength(JSON.stringify(trimmed), 'utf8') > maxBytes) {
            trimmed.shift();
        }
        console.warn(`[SyncManager] Cookie payload exceeded ${maxBytes} bytes — trimmed to ${trimmed.length} cookies for cloud sync.`);
        return trimmed;
    }

    // Save profile metadata & cookies with Hash optimization
    async saveProfile(profile, currentUser = 'unknown_user') {
        const id = this.sanitizeProfileId(profile.id);
        const newCookieHash = this.getCookiesHash(profile.cookies);
        const prevCookieHash = this.cookieHashes.get(id);

        const profileData = {
            id,
            name: profile.name || 'Unnamed Profile',
            url: profile.url || 'https://google.com',
            proxy: profile.proxy || '',
            userAgent: profile.userAgent || '',
            timezone: profile.timezone || '',
            cookies: profile.cookies || [],
            activeHolder: profile.activeHolder || null,
            updatedAt: profile.updatedAt || Date.now(),
            lastSyncUser: currentUser,
            lastSyncDevice: this.deviceId
        };

        // 1. Always save locally
        const localFile = path.join(this.localStorageDir, `profile_${id}.json`);
        await fs.writeJson(localFile, profileData, { spaces: 2 });

        // 2. Always sync profile & metadata to Firebase Cloud Firestore
        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                const profileRef = doc(db, 'profiles', id);
                const { activeHolderChanged, ...dataToSync } = profileData;
                dataToSync.cookies = this.trimCookiesForSync(dataToSync.cookies);
                const cleanDataToSync = JSON.parse(JSON.stringify(dataToSync));
                await setDoc(profileRef, cleanDataToSync, { merge: true });
                this.cookieHashes.set(id, newCookieHash);
                console.log(`[SyncManager] Profile '${profile.name}' (${id}) synced to Cloud Firestore.`);
            } catch (error) {
                console.error(`[SyncManager] Firestore sync failed for profile '${id}':`, error.message);
            }
        }
        return profileData;
    }

    // Update Active Holder when browser opens or closes
    async setActiveHolder(profileId, username, isLaunching) {
        const id = this.sanitizeProfileId(profileId);
        const profile = await this.getProfile(id);
        if (!profile) return;

        if (isLaunching) {
            profile.activeHolder = {
                username,
                deviceId: this.deviceId,
                launchedAt: Date.now()
            };
        } else {
            // Only clear if we were the holder
            if (profile.activeHolder && profile.activeHolder.deviceId === this.deviceId) {
                profile.activeHolder = null;
            }
        }
        profile.activeHolderChanged = true;
        await this.saveProfile(profile, username);
    }

    // Fetch latest profile & cookies from Cloud or Local
    async getProfile(profileId) {
        const id = this.sanitizeProfileId(profileId);
        let profileData = null;
        const localFile = path.join(this.localStorageDir, `profile_${id}.json`);
        let localData = null;

        if (await fs.pathExists(localFile)) {
            try {
                localData = await fs.readJson(localFile);
            } catch (e) {}
        }

        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                const profileRef = doc(db, 'profiles', id);
                const docSnap = await getDoc(profileRef);
                if (docSnap.exists()) {
                    const cloudData = docSnap.data();
                    const localCookieCount = (localData && Array.isArray(localData.cookies)) ? localData.cookies.length : 0;
                    const cloudCookieCount = (cloudData && Array.isArray(cloudData.cookies)) ? cloudData.cookies.length : 0;
                    const localTime = (localData && localData.updatedAt) ? localData.updatedAt : 0;
                    const cloudTime = (cloudData && cloudData.updatedAt) ? cloudData.updatedAt : 0;

                    // Preserve local data if local has cookies and is newer or equal
                    if (!localData || (cloudCookieCount > 0 && cloudTime >= localTime) || (localCookieCount === 0 && cloudCookieCount > 0)) {
                        profileData = cloudData;
                        await fs.writeJson(localFile, profileData, { spaces: 2 });
                    } else {
                        profileData = localData;
                    }
                    this.cookieHashes.set(id, this.getCookiesHash(profileData.cookies));
                    return profileData;
                }
            } catch (error) {
                console.warn(`[SyncManager] Could not fetch profile from Firestore:`, error.message);
            }
        }

        if (localData) {
            profileData = localData;
            this.cookieHashes.set(id, this.getCookiesHash(profileData.cookies));
        }
        return profileData;
    }

    // Live Real-Time Subscription for Parallel Multi-User Access
    subscribeToProfile(profileId, onRemoteUpdate) {
        const id = this.sanitizeProfileId(profileId);
        if (!isFirebaseConfigured()) return () => {};

        if (this.activeSubscriptions.has(id)) {
            this.activeSubscriptions.get(id)();
        }

        try {
            const db = getDb();
            const profileRef = doc(db, 'profiles', id);
            const unsubscribe = onSnapshot(profileRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    // Ignore echo updates from local device ID
                    if (data.lastSyncDevice !== this.deviceId) {
                        console.log(`[SyncManager] Live remote update received for profile '${id}' from user '${data.lastSyncUser}'.`);
                        onRemoteUpdate(data);
                    }
                }
            }, (error) => {
                console.warn(`[SyncManager] Real-time subscription error for profile '${id}':`, error.message);
            });

            this.activeSubscriptions.set(id, unsubscribe);
            return unsubscribe;
        } catch (e) {
            console.warn(`[SyncManager] Failed to establish live subscription for profile '${id}':`, e.message);
            return () => {};
        }
    }

    unsubscribeProfile(profileId) {
        const id = this.sanitizeProfileId(profileId);
        if (this.activeSubscriptions.has(id)) {
            this.activeSubscriptions.get(id)();
            this.activeSubscriptions.delete(id);
        }
    }

    subscribeToProfilesCollection(onProfilesUpdated) {
        if (!isFirebaseConfigured()) return () => {};
        if (this.profilesCollectionUnsubscribe) {
            this.profilesCollectionUnsubscribe();
            this.profilesCollectionUnsubscribe = null;
        }

        try {
            const db = getDb();
            const profilesRef = collection(db, 'profiles');
            this.profilesCollectionUnsubscribe = onSnapshot(profilesRef, (snapshot) => {
                let changed = false;
                snapshot.docChanges().forEach((change) => {
                    const cloudData = change.doc.data();
                    if (cloudData && cloudData.id) {
                        const localFile = path.join(this.localStorageDir, `profile_${cloudData.id}.json`);
                        if (change.type === 'removed') {
                            if (fs.existsSync(localFile)) {
                                fs.removeSync(localFile);
                                changed = true;
                            }
                        } else if (change.type === 'added' || change.type === 'modified') {
                            if (cloudData.lastSyncDevice !== this.deviceId) {
                                fs.writeJsonSync(localFile, cloudData, { spaces: 2 });
                                changed = true;
                            }
                        }
                    }
                });

                if (changed || snapshot.metadata.hasPendingWrites === false) {
                    if (typeof onProfilesUpdated === 'function') {
                        onProfilesUpdated();
                    }
                }
            }, (error) => {
                console.warn('[SyncManager] Real-time profiles collection subscription error:', error.message);
            });

            return this.profilesCollectionUnsubscribe;
        } catch (e) {
            console.warn('[SyncManager] Failed to establish live profiles collection subscription:', e.message);
            return () => {};
        }
    }

    unsubscribeFromProfilesCollection() {
        if (this.profilesCollectionUnsubscribe) {
            this.profilesCollectionUnsubscribe();
            this.profilesCollectionUnsubscribe = null;
        }
    }

    // List all profiles available (queries Cloud Firestore first if configured)
    async listProfiles() {
        const profilesMap = new Map();

        // 1. Load local profiles first
        try {
            const files = await fs.readdir(this.localStorageDir);
            for (const file of files) {
                if (file.startsWith('profile_') && file.endsWith('.json')) {
                    try {
                        const data = await fs.readJson(path.join(this.localStorageDir, file));
                        if (data && data.id) {
                            profilesMap.set(data.id, data);
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}

        // 2. Fetch from Cloud Firestore if configured
        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                const querySnapshot = await getDocs(collection(db, 'profiles'));
                querySnapshot.forEach((docSnap) => {
                    const cloudData = docSnap.data();
                    if (cloudData && cloudData.id) {
                        const localData = profilesMap.get(cloudData.id);
                        const localTime = localData ? (localData.updatedAt || 0) : 0;
                        const cloudTime = cloudData.updatedAt || 0;
                        const localCookies = (localData && Array.isArray(localData.cookies)) ? localData.cookies.length : 0;
                        const cloudCookies = (cloudData && Array.isArray(cloudData.cookies)) ? cloudData.cookies.length : 0;

                        if (!localData || (cloudCookies > 0 && cloudTime >= localTime) || (localCookies === 0 && cloudCookies > 0)) {
                            profilesMap.set(cloudData.id, cloudData);
                            const localFile = path.join(this.localStorageDir, `profile_${cloudData.id}.json`);
                            fs.writeJsonSync(localFile, cloudData, { spaces: 2 });
                        }
                    }
                });
            } catch (error) {
                console.warn(`[SyncManager] Could not fetch profiles list from Firestore:`, error.message);
            }
        }

        return Array.from(profilesMap.values());
    }

    // Delete profile locally and in Firestore
    async deleteProfile(profileId) {
        const id = this.sanitizeProfileId(profileId);
        this.unsubscribeProfile(id);
        const localFile = path.join(this.localStorageDir, `profile_${id}.json`);
        if (await fs.pathExists(localFile)) {
            await fs.remove(localFile);
        }

        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                const profileRef = doc(db, 'profiles', id);
                await deleteDoc(profileRef);
                console.log(`[SyncManager] Profile '${id}' deleted from Cloud Firestore.`);
            } catch (error) {
                console.warn(`[SyncManager] Could not delete profile '${id}' from Firestore:`, error.message);
            }
        }
    }

    // Team Audit Trail & Activity Log
    async logActivity({ action, username, profileId, profileName, details = '' }) {
        const logEntry = {
            action: action || 'UNKNOWN_ACTION',
            username: username || 'system',
            profileId: profileId || null,
            profileName: profileName || null,
            details: details || '',
            deviceId: this.deviceId,
            timestamp: Date.now()
        };

        // 1. Save locally
        const logsFile = path.join(this.localStorageDir, 'audit_logs.json');
        try {
            let logs = [];
            if (await fs.pathExists(logsFile)) {
                logs = await fs.readJson(logsFile);
            }
            logs.unshift(logEntry);
            if (logs.length > 200) logs = logs.slice(0, 200); // keep recent 200
            await fs.writeJson(logsFile, logs, { spaces: 2 });
        } catch (e) {}

        // 2. Save to Cloud Firestore
        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                await addDoc(collection(db, 'auditLogs'), logEntry);
                console.log(`[SyncManager] Audit log recorded: ${action} by ${username}`);
            } catch (error) {
                console.warn('[SyncManager] Firestore audit log failed:', error.message);
            }
        }
    }

    async getAuditLogs() {
        if (isFirebaseConfigured()) {
            try {
                const db = getDb();
                const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(50));
                const snapshot = await getDocs(q);
                const cloudLogs = [];
                snapshot.forEach(docSnap => {
                    cloudLogs.push({ id: docSnap.id, ...docSnap.data() });
                });
                if (cloudLogs.length > 0) return cloudLogs;
            } catch (error) {
                console.warn('[SyncManager] Could not fetch audit logs from Firestore:', error.message);
            }
        }

        // Fallback to local logs
        const logsFile = path.join(this.localStorageDir, 'audit_logs.json');
        try {
            if (await fs.pathExists(logsFile)) {
                return await fs.readJson(logsFile);
            }
        } catch (e) {}
        return [];
    }
}

module.exports = SyncManager;
