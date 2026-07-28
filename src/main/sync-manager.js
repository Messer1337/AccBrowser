const { getBackendProvider } = require('../config/backend');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

function getSafeStorage() {
    try {
        const electron = require('electron');
        return electron && electron.safeStorage && typeof electron.safeStorage.isEncryptionAvailable === 'function'
            ? electron.safeStorage
            : null;
    } catch (error) {
        return null;
    }
}

class SyncManager {
    constructor(userDataPath, secretStorage = getSafeStorage()) {
        this.userDataPath = userDataPath;
        this.localStorageDir = path.join(userDataPath, 'local_db');
        fs.ensureDirSync(this.localStorageDir);
        this.activeSubscriptions = new Map();
        this.cookieHashes = new Map(); // profileId -> string hash
        this.cloudProfileHashes = new Map(); // profileId -> serialized cloud payload hash
        this.secretStorage = secretStorage;
        this.localSecretsEncrypted = this.canEncryptLocalSecrets();
        this.metricsFile = path.join(this.localStorageDir, 'sync_metrics.json');
        this.deviceId = this.initDeviceId();
    }

    canEncryptLocalSecrets() {
        try {
            return Boolean(this.secretStorage && this.secretStorage.isEncryptionAvailable());
        } catch (error) {
            return false;
        }
    }

    encodeLocalProfile(profileData) {
        const copy = JSON.parse(JSON.stringify(profileData));
        if (!this.localSecretsEncrypted) return copy;
        try {
            copy.cookiesEncrypted = this.secretStorage.encryptString(JSON.stringify(copy.cookies || [])).toString('base64');
            copy.localSecretsFormat = 'safeStorage-v1';
            delete copy.cookies;
            return copy;
        } catch (error) {
            throw new Error(`Не вдалося зашифрувати локальні cookies: ${error.message}`);
        }
    }

    decodeLocalProfile(storedProfile) {
        if (!storedProfile || typeof storedProfile !== 'object') return storedProfile;
        if (!storedProfile.cookiesEncrypted) return storedProfile;
        if (!this.localSecretsEncrypted) {
            const error = new Error('Локальні cookies зашифровані системним keychain, але ключ недоступний у цьому середовищі.');
            error.code = 'LOCAL_SECRET_UNAVAILABLE';
            throw error;
        }
        try {
            const cookies = JSON.parse(this.secretStorage.decryptString(Buffer.from(storedProfile.cookiesEncrypted, 'base64')));
            if (!Array.isArray(cookies)) throw new Error('Розшифровані cookies мають некоректний формат.');
            const { cookiesEncrypted, localSecretsFormat, ...profile } = storedProfile;
            return { ...profile, cookies };
        } catch (cause) {
            const error = new Error(`Не вдалося розшифрувати локальні cookies: ${cause.message}`);
            error.code = 'LOCAL_SECRET_UNAVAILABLE';
            throw error;
        }
    }

    async writeLocalProfile(filePath, profileData) {
        await fs.writeJson(filePath, this.encodeLocalProfile(profileData), { spaces: 2 });
    }

    writeLocalProfileSync(filePath, profileData) {
        fs.writeJsonSync(filePath, this.encodeLocalProfile(profileData), { spaces: 2 });
    }

    async readLocalProfile(filePath) {
        return this.decodeLocalProfile(await fs.readJson(filePath));
    }

    async recordSyncMetric(profileId, metric, bytes = 0) {
        const id = this.sanitizeProfileId(profileId);
        const day = new Date().toISOString().slice(0, 10);
        try {
            const metrics = await fs.pathExists(this.metricsFile)
                ? await fs.readJson(this.metricsFile)
                : { version: 1, days: {} };
            const daily = metrics.days[day] || { profiles: {}, listenerErrors: 0 };
            const profile = daily.profiles[id] || { cloudWrites: 0, bytesSynced: 0, conflicts: 0, cloudErrors: 0 };
            if (metric === 'listenerError') {
                daily.listenerErrors += 1;
            } else if (Object.hasOwn(profile, metric)) {
                profile[metric] += 1;
                if (metric === 'cloudWrites') profile.bytesSynced += Math.max(0, bytes);
            }
            daily.profiles[id] = profile;
            metrics.days[day] = daily;
            // Keep a compact 30-day operational window; metrics contain no session data.
            const days = Object.keys(metrics.days).sort().reverse();
            for (const oldDay of days.slice(30)) delete metrics.days[oldDay];
            await fs.writeJson(this.metricsFile, metrics, { spaces: 2 });
        } catch (error) {
            console.warn('[SyncManager] Metrics write notice:', error.message);
        }
    }

    initDeviceId() {
        const deviceFile = path.join(this.userDataPath, 'device_id.json');
        try {
            if (fs.existsSync(deviceFile)) {
                const data = fs.readJsonSync(deviceFile);
                if (data.deviceId) return data.deviceId;
            }
        } catch (error) {
            console.warn('[SyncManager] Device ID read notice:', error.message);
        }

        const newId = `device_${crypto.randomUUID()}`;
        try {
            fs.writeJsonSync(deviceFile, { deviceId: newId }, { spaces: 2 });
        } catch (error) {
            console.warn('[SyncManager] Device ID write notice:', error.message);
        }
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
        const normalized = cookies.map(cookie => {
            const ordered = {};
            for (const key of Object.keys(cookie || {}).sort()) ordered[key] = cookie[key];
            return ordered;
        }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    }

    hasCookieChanges(profileId, cookies) {
        const id = this.sanitizeProfileId(profileId);
        return this.cookieHashes.get(id) !== this.getCookiesHash(cookies);
    }

    getCloudProfileHash(profileData) {
        return crypto.createHash('sha256').update(JSON.stringify(profileData)).digest('hex');
    }

    prepareCloudProfileData(profileData) {
        // Leases are owned exclusively by the backend. A metadata save must never replay
        // a stale local holder and release or steal an active browser session.
        const { activeHolderChanged, activeHolder, ...dataToSync } = profileData;
        dataToSync.cookies = this.validateCookiesForCloudSync(dataToSync.cookies);
        return JSON.parse(JSON.stringify(dataToSync));
    }

    // Losing a session cookie is worse than delaying sync. Keep the full local state and
    // reject an oversized cloud payload explicitly instead of silently dropping cookies.
    validateCookiesForCloudSync(cookies, maxBytes = 700000) {
        if (!Array.isArray(cookies)) return [];
        const bytes = Buffer.byteLength(JSON.stringify(cookies), 'utf8');
        if (bytes > maxBytes) {
            throw new Error(`Cookies профілю мають ${bytes} B і перевищують cloud-ліміт ${maxBytes} B. Сесію збережено локально, але не синхронізовано.`);
        }
        return cookies;
    }

    // Save profile metadata & cookies with Hash optimization
    async saveProfile(profile, currentUser = 'unknown_user', { cloudMode = 'full' } = {}) {
        const id = this.sanitizeProfileId(profile.id);
        const newCookieHash = this.getCookiesHash(profile.cookies);

        const profileData = {
            id,
            name: profile.name || 'Unnamed Profile',
            url: profile.url || 'https://google.com',
            proxy: profile.proxy || '',
            userAgent: profile.userAgent || '',
            timezone: profile.timezone || '',
            cookies: profile.cookies || [],
            fingerprint: profile.fingerprint || null,
            fingerprintHeaders: profile.fingerprintHeaders || {},
            fingerprintUpdatedAt: profile.fingerprintUpdatedAt || null,
            activeHolder: profile.activeHolder || null,
            revision: Number.isInteger(profile.revision) && profile.revision >= 0 ? profile.revision : 0,
            updatedBy: profile.updatedBy || currentUser,
            updatedAt: profile.updatedAt || Date.now(),
            lastSyncUser: currentUser,
            lastSyncDevice: this.deviceId
        };

        // 1. Always save locally
        const localFile = path.join(this.localStorageDir, `profile_${id}.json`);
        await this.writeLocalProfile(localFile, profileData);
        this.cookieHashes.set(id, newCookieHash);
        let cloudSyncError = null;
        const provider = getBackendProvider();

        // 2. Always sync profile & metadata to the backend
        if (provider.isConfigured() && cloudMode === 'session') {
            try {
                const response = await provider.syncProfileSession(id, {
                    deviceId: this.deviceId,
                    cookies: profileData.cookies,
                    expectedRevision: profileData.revision
                });
                profileData.revision = response.revision;
                profileData.updatedAt = response.updatedAt;
                profileData.updatedBy = response.updatedBy || currentUser;
                await this.writeLocalProfile(localFile, profileData);
                this.cloudProfileHashes.set(id, this.getCloudProfileHash(this.prepareCloudProfileData(profileData)));
                await this.recordSyncMetric(id, 'cloudWrites', Buffer.byteLength(JSON.stringify(profileData.cookies), 'utf8'));
            } catch (error) {
                cloudSyncError = error.message;
                await this.recordSyncMetric(id, error.code === 'failed-precondition' ? 'conflicts' : 'cloudErrors');
                console.error(`[SyncManager] Protected session sync failed for profile '${id}':`, error.message);
            }
        } else if (provider.isConfigured() && cloudMode === 'full') {
            try {
                const cleanDataToSync = this.prepareCloudProfileData(profileData);
                const result = await provider.saveProfileFull(id, cleanDataToSync, profileData.revision, currentUser);
                profileData.revision = result.revision;
                profileData.updatedBy = currentUser;
                await this.writeLocalProfile(localFile, profileData);
                this.cloudProfileHashes.set(id, this.getCloudProfileHash(this.prepareCloudProfileData(profileData)));
                await this.recordSyncMetric(id, 'cloudWrites', Buffer.byteLength(JSON.stringify(profileData.cookies), 'utf8'));
                console.log(`[SyncManager] Profile '${profile.name}' (${id}) synced to the backend at revision ${result.revision}.`);
            } catch (error) {
                cloudSyncError = error.message;
                await this.recordSyncMetric(id, error.code === 'failed-precondition' ? 'conflicts' : 'cloudErrors');
                console.error(`[SyncManager] Backend sync failed for profile '${id}':`, error.message);
            }
        }
        return cloudSyncError ? { ...profileData, cloudSyncError } : profileData;
    }

    // The first device to claim a profile proposes its generated fingerprint. The backend
    // stores it only once, so parallel devices converge on one identity.
    async ensureProfileFingerprint(profile, currentUser = 'unknown_user') {
        const id = this.sanitizeProfileId(profile.id);
        await this.saveProfile(profile, currentUser, { cloudMode: 'local' });
        const provider = getBackendProvider();
        if (!provider.isConfigured()) return profile;

        try {
            const result = await provider.ensureProfileFingerprint(id, {
                fingerprint: profile.fingerprint,
                fingerprintHeaders: profile.fingerprintHeaders || {}
            });
            if (result && result.fingerprint) {
                profile.fingerprint = result.fingerprint;
                profile.fingerprintHeaders = result.fingerprintHeaders || {};
                profile.fingerprintUpdatedAt = result.fingerprintUpdatedAt || profile.fingerprintUpdatedAt;
                profile.revision = Number.isInteger(result.revision) ? result.revision : profile.revision;
                profile.updatedAt = result.fingerprintUpdatedAt || profile.updatedAt;
                await this.saveProfile(profile, currentUser, { cloudMode: 'local' });
            }
        } catch (error) {
            // A locally persisted fingerprint is still preferable to a new random identity
            // while an offline client waits for the protected backend endpoint to recover.
            console.warn(`[SyncManager] Could not pin fingerprint for '${id}':`, error.message);
        }
        return profile;
    }

    // Update Active Holder when browser opens or closes
    async setActiveHolder(profileId, username, isLaunching) {
        const id = this.sanitizeProfileId(profileId);
        const profile = await this.getProfile(id);
        if (!profile) return;

        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            const response = isLaunching
                ? await provider.claimProfileLease(id, this.deviceId)
                : await provider.releaseProfileLease(id, this.deviceId);
            profile.activeHolder = response.activeHolder || null;
        } else if (isLaunching) {
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
        await this.saveProfile(profile, username, { cloudMode: provider.isConfigured() ? 'local' : 'full' });
        return profile.activeHolder;
    }

    async heartbeatProfileLease(profileId) {
        const provider = getBackendProvider();
        if (!provider.isConfigured()) return null;
        const id = this.sanitizeProfileId(profileId);
        const response = await provider.heartbeatProfileLease(id, this.deviceId);
        return response.activeHolder || null;
    }

    // Fetch latest profile & cookies from Cloud or Local
    async getProfile(profileId) {
        const id = this.sanitizeProfileId(profileId);
        let profileData = null;
        const localFile = path.join(this.localStorageDir, `profile_${id}.json`);
        let localData = null;

        if (await fs.pathExists(localFile)) {
            try {
            localData = await this.readLocalProfile(localFile);
        } catch (error) {
            if (error.code === 'LOCAL_SECRET_UNAVAILABLE') throw error;
        }
        }

        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            try {
                const cloudData = await provider.getProfile(id);
                if (cloudData) {
                    const localCookieCount = (localData && Array.isArray(localData.cookies)) ? localData.cookies.length : 0;
                    const cloudCookieCount = (cloudData && Array.isArray(cloudData.cookies)) ? cloudData.cookies.length : 0;
                    const localTime = (localData && localData.updatedAt) ? localData.updatedAt : 0;
                    const cloudTime = (cloudData && cloudData.updatedAt) ? cloudData.updatedAt : 0;

                    // Preserve local data if local has cookies and is newer or equal
                    if (!localData || (cloudCookieCount > 0 && cloudTime >= localTime) || (localCookieCount === 0 && cloudCookieCount > 0)) {
                        profileData = cloudData;
                        await this.writeLocalProfile(localFile, profileData);
                    } else {
                        profileData = localData;
                    }
                    this.cookieHashes.set(id, this.getCookiesHash(profileData.cookies));
                    this.cloudProfileHashes.set(id, this.getCloudProfileHash(this.prepareCloudProfileData(profileData)));
                    return profileData;
                }
            } catch (error) {
                console.warn(`[SyncManager] Could not fetch profile from the backend:`, error.message);
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
        const provider = getBackendProvider();
        if (!provider.isConfigured()) return () => {};

        if (this.activeSubscriptions.has(id)) {
            this.activeSubscriptions.get(id)();
        }

        const unsubscribe = provider.subscribeProfile(id, {
            onUpdate: (data) => {
                // Ignore echo updates from local device ID
                if (data.lastSyncDevice !== this.deviceId) {
                    this.cookieHashes.set(id, this.getCookiesHash(data.cookies));
                    this.cloudProfileHashes.set(id, this.getCloudProfileHash(this.prepareCloudProfileData(data)));
                    console.log(`[SyncManager] Live remote update received for profile '${id}' from user '${data.lastSyncUser}'.`);
                    onRemoteUpdate(data);
                }
            },
            onError: (error) => {
                this.recordSyncMetric(id, 'listenerError');
                console.warn(`[SyncManager] Real-time subscription error for profile '${id}':`, error.message);
            }
        });

        this.activeSubscriptions.set(id, unsubscribe);
        return unsubscribe;
    }

    unsubscribeProfile(profileId) {
        const id = this.sanitizeProfileId(profileId);
        if (this.activeSubscriptions.has(id)) {
            this.activeSubscriptions.get(id)();
            this.activeSubscriptions.delete(id);
        }
    }

    subscribeToProfilesCollection(onProfilesUpdated) {
        const provider = getBackendProvider();
        if (!provider.isConfigured()) return () => {};
        if (this.profilesCollectionUnsubscribe) {
            this.profilesCollectionUnsubscribe();
            this.profilesCollectionUnsubscribe = null;
        }

        this.profilesCollectionUnsubscribe = provider.subscribeProfilesCollection({
            onDocChanges: (changes) => {
                let changed = false;
                changes.forEach((change) => {
                    const cloudData = change.data;
                    if (cloudData && cloudData.id) {
                        const localFile = path.join(this.localStorageDir, `profile_${cloudData.id}.json`);
                        if (change.type === 'removed') {
                            if (fs.existsSync(localFile)) {
                                fs.removeSync(localFile);
                                changed = true;
                            }
                        } else if (change.type === 'added' || change.type === 'modified') {
                            if (cloudData.lastSyncDevice !== this.deviceId) {
                                this.writeLocalProfileSync(localFile, cloudData);
                                this.cookieHashes.set(cloudData.id, this.getCookiesHash(cloudData.cookies));
                                this.cloudProfileHashes.set(cloudData.id, this.getCloudProfileHash(this.prepareCloudProfileData(cloudData)));
                                changed = true;
                            }
                        }
                    }
                });

                if (changed && typeof onProfilesUpdated === 'function') {
                    onProfilesUpdated();
                }
            },
            onError: (error) => {
                this.recordSyncMetric('collection_listener', 'listenerError');
                console.warn('[SyncManager] Real-time profiles collection subscription error:', error.message);
            }
        });

        return this.profilesCollectionUnsubscribe;
    }

    unsubscribeFromProfilesCollection() {
        if (this.profilesCollectionUnsubscribe) {
            this.profilesCollectionUnsubscribe();
            this.profilesCollectionUnsubscribe = null;
        }
    }

    // List profiles. Non-admin callers provide explicit allowed IDs because per-profile
    // ACLs cannot safely be proven by a mixed-access collection query.
    async listProfiles(allowedProfileIds = null) {
        const profilesMap = new Map();
        const restrictedIds = Array.isArray(allowedProfileIds)
            ? allowedProfileIds.map(id => this.sanitizeProfileId(id))
            : null;

        // 1. Load local profiles first
        try {
            const files = await fs.readdir(this.localStorageDir);
            for (const file of files) {
                if (file.startsWith('profile_') && file.endsWith('.json')) {
                    try {
                        const data = await this.readLocalProfile(path.join(this.localStorageDir, file));
                        if (data && data.id) {
                            profilesMap.set(data.id, data);
                        }
                    } catch (error) {
                        console.warn('[SyncManager] Local profile read notice:', error.message);
                    }
                }
            }
        } catch (error) {
            console.warn('[SyncManager] Local profile directory notice:', error.message);
        }

        // 2. Workers fetch only their individually authorized documents. A collection query
        // could not safely prove per-profile ACLs.
        if (restrictedIds) {
            for (const id of restrictedIds) {
                const profile = await this.getProfile(id);
                if (profile) profilesMap.set(id, profile);
            }
            return restrictedIds.map(id => profilesMap.get(id)).filter(Boolean);
        }

        // 3. Admins may fetch the complete backend collection.
        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            try {
                const cloudProfiles = await provider.listProfiles();
                cloudProfiles.forEach((cloudData) => {
                    if (cloudData && cloudData.id) {
                        const localData = profilesMap.get(cloudData.id);
                        const localTime = localData ? (localData.updatedAt || 0) : 0;
                        const cloudTime = cloudData.updatedAt || 0;
                        const localCookies = (localData && Array.isArray(localData.cookies)) ? localData.cookies.length : 0;
                        const cloudCookies = (cloudData && Array.isArray(cloudData.cookies)) ? cloudData.cookies.length : 0;

                        if (!localData || (cloudCookies > 0 && cloudTime >= localTime) || (localCookies === 0 && cloudCookies > 0)) {
                            profilesMap.set(cloudData.id, cloudData);
                            const localFile = path.join(this.localStorageDir, `profile_${cloudData.id}.json`);
                            this.writeLocalProfileSync(localFile, cloudData);
                            this.cookieHashes.set(cloudData.id, this.getCookiesHash(cloudData.cookies));
                            this.cloudProfileHashes.set(cloudData.id, this.getCloudProfileHash(this.prepareCloudProfileData(cloudData)));
                        }
                    }
                });
            } catch (error) {
                console.warn(`[SyncManager] Could not fetch profiles list from the backend:`, error.message);
            }
        }

        return Array.from(profilesMap.values());
    }

    // Delete profile locally and on the backend
    async deleteProfile(profileId) {
        const id = this.sanitizeProfileId(profileId);
        this.unsubscribeProfile(id);
        const localFile = path.join(this.localStorageDir, `profile_${id}.json`);
        if (await fs.pathExists(localFile)) {
            await fs.remove(localFile);
        }

        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            try {
                await provider.deleteProfile(id);
                console.log(`[SyncManager] Profile '${id}' deleted from the backend.`);
            } catch (error) {
                console.warn(`[SyncManager] Could not delete profile '${id}' from the backend:`, error.message);
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
        } catch (error) {
            console.warn('[SyncManager] Local audit log write notice:', error.message);
        }

        // 2. Save to the backend
        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            try {
                await provider.logActivity(logEntry);
                console.log(`[SyncManager] Audit log recorded: ${action} by ${username}`);
            } catch (error) {
                console.warn('[SyncManager] Backend audit log failed:', error.message);
            }
        }
    }

    async getAuditLogs() {
        const provider = getBackendProvider();
        if (provider.isConfigured()) {
            try {
                const cloudLogs = await provider.getAuditLogs(50);
                if (cloudLogs.length > 0) return cloudLogs;
            } catch (error) {
                console.warn('[SyncManager] Could not fetch audit logs from the backend:', error.message);
            }
        }

        // Fallback to local logs
        const logsFile = path.join(this.localStorageDir, 'audit_logs.json');
        try {
            if (await fs.pathExists(logsFile)) {
                return await fs.readJson(logsFile);
            }
        } catch (error) {
            console.warn('[SyncManager] Local audit log read notice:', error.message);
        }
        return [];
    }
}

module.exports = SyncManager;
