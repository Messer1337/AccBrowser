const { io } = require('socket.io-client');
const { ERROR_CODES, backendError } = require('./provider');

function mapStatusToCode(status) {
    if (status === 401) return ERROR_CODES.UNAUTHENTICATED;
    if (status === 403) return ERROR_CODES.PERMISSION_DENIED;
    if (status === 404) return ERROR_CODES.NOT_FOUND;
    if (status === 409 || status === 412) return ERROR_CODES.FAILED_PRECONDITION;
    if (status === 413 || status === 429) return ERROR_CODES.RESOURCE_EXHAUSTED;
    if (status === 400) return ERROR_CODES.INVALID_ARGUMENT;
    return ERROR_CODES.UNAVAILABLE;
}

class SelfHostedProvider {
    constructor({ baseUrl }) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.token = null;
        this.socket = null;
        this.socketSubscribers = {
            profile: new Map(),   // profileId -> Set<onUpdate>
            profiles: new Set(),  // Set<onDocChanges>
            teamUser: new Map()   // username -> { onExists, onMissing }
        };
    }

    isConfigured() {
        return Boolean(this.baseUrl);
    }

    getMode() {
        return this.token ? 'Власний сервер (підключено)' : 'Власний сервер';
    }

    async request(method, path, body) {
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
                },
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
        } catch (networkError) {
            throw backendError(ERROR_CODES.UNAVAILABLE, `Власний сервер недоступний: ${networkError.message}`);
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (_e) {
            payload = null;
        }

        if (!response.ok) {
            const message = (payload && payload.message) || `Запит завершився з кодом ${response.status}`;
            throw backendError(mapStatusToCode(response.status), message);
        }
        return payload;
    }

    ensureSocket() {
        if (this.socket || !this.token) return;
        this.socket = io(this.baseUrl, { auth: { token: this.token }, transports: ['websocket'] });

        this.socket.on('profile-updated', ({ profileId, data }) => {
            const subscribers = this.socketSubscribers.profile.get(profileId);
            if (subscribers) subscribers.forEach(({ onUpdate }) => onUpdate(data));
        });
        this.socket.on('profiles-changed', (changes) => {
            this.socketSubscribers.profiles.forEach(onDocChanges => onDocChanges(changes));
        });
        this.socket.on('team-user-updated', ({ username, data }) => {
            const sub = this.socketSubscribers.teamUser.get(username);
            if (sub) sub.onExists(data);
        });
        this.socket.on('team-user-revoked', ({ username }) => {
            const sub = this.socketSubscribers.teamUser.get(username);
            if (sub) sub.onMissing();
        });
        this.socket.on('connect_error', (error) => {
            console.warn('[SelfHostedProvider] Socket connection error:', error.message);
        });
        // Room membership lives on the server-side socket connection, not the client
        // object. socket.io-client auto-reconnects after a dropped connection (laptop
        // sleep, wifi flicker) but that reconnection is a brand-new server-side socket
        // with no rooms joined — without replaying subscriptions here, live sync would
        // silently go dead until the app restarts.
        this.socket.on('connect', () => {
            for (const profileId of this.socketSubscribers.profile.keys()) {
                this.socket.emit('subscribe:profile', { profileId });
            }
            if (this.socketSubscribers.profiles.size > 0) {
                this.socket.emit('subscribe:profiles');
            }
        });
    }

    // Authenticates directly against the self-hosted server (which owns password
    // verification, unlike Firebase's client-side derived-secret scheme) and returns the
    // caller's role/ACL in the same call. A missing account (404) throws NOT_FOUND so the
    // caller's revoke-vs-not-yet-synced logic applies; an unreachable server or rejected
    // credential (network error / 401) resolves { authenticated: false } instead of
    // throwing, so a stale/offline device keeps using its cached local data — matching
    // FirebaseProvider's forgiving behavior for the same situations.
    async login(username, password) {
        if (!password) return { authenticated: false };
        try {
            const result = await this.request('POST', '/api/auth/login', { username, password });
            this.token = result.token;
            this.ensureSocket();
            return {
                authenticated: true,
                uid: result.user.uid,
                role: result.user.role,
                allowedProfiles: result.user.allowedProfiles,
                firebaseUid: result.user.uid,
                mustChangePassword: Boolean(result.user.mustChangePassword)
            };
        } catch (err) {
            if (err.code === ERROR_CODES.NOT_FOUND) throw err;
            if (err.code === ERROR_CODES.UNAUTHENTICATED || err.code === ERROR_CODES.UNAVAILABLE) {
                return { authenticated: false };
            }
            throw err;
        }
    }

    async logout() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.token = null;
    }

    async changeOwnPassword(newPassword) {
        try {
            await this.request('POST', '/api/auth/change-password', { newPassword });
        } catch (err) {
            console.warn('[SelfHostedProvider] Could not rotate password on self-hosted server:', err.message);
        }
    }

    subscribeCurrentUser(username, { onExists, onMissing }) {
        if (!this.token) return () => {};
        this.ensureSocket();
        this.socketSubscribers.teamUser.set(username, { onExists, onMissing });
        return () => this.socketSubscribers.teamUser.delete(username);
    }

    async upsertTeamUser({ username, role, allowedProfiles, password }) {
        const result = await this.request('POST', '/api/team-users', { username, role, allowedProfiles, password });
        return { uid: result.uid };
    }

    async deleteTeamUser(username) {
        await this.request('DELETE', `/api/team-users/${encodeURIComponent(username)}`);
    }

    async listTeamUsers() {
        const result = await this.request('GET', '/api/team-users');
        return result.users || [];
    }

    async getProfile(id) {
        try {
            return await this.request('GET', `/api/profiles/${encodeURIComponent(id)}`);
        } catch (err) {
            if (err.code === ERROR_CODES.NOT_FOUND) return null;
            throw err;
        }
    }

    async listProfiles() {
        const result = await this.request('GET', '/api/profiles');
        return result.profiles || [];
    }

    async saveProfileFull(id, cleanData, expectedRevision) {
        return this.request('PUT', `/api/profiles/${encodeURIComponent(id)}`, { data: cleanData, expectedRevision });
    }

    async syncProfileSession(id, { deviceId, cookies, expectedRevision }) {
        return this.request('POST', `/api/profiles/${encodeURIComponent(id)}/session-sync`, { deviceId, cookies, expectedRevision });
    }

    async ensureProfileFingerprint(id, { fingerprint, fingerprintHeaders }) {
        return this.request('POST', `/api/profiles/${encodeURIComponent(id)}/fingerprint`, { fingerprint, fingerprintHeaders: fingerprintHeaders || {} });
    }

    async claimProfileLease(id, deviceId) {
        return this.request('POST', `/api/profiles/${encodeURIComponent(id)}/lease/claim`, { deviceId });
    }

    async heartbeatProfileLease(id, deviceId) {
        return this.request('POST', `/api/profiles/${encodeURIComponent(id)}/lease/heartbeat`, { deviceId });
    }

    async releaseProfileLease(id, deviceId) {
        return this.request('POST', `/api/profiles/${encodeURIComponent(id)}/lease/release`, { deviceId });
    }

    async deleteProfile(id) {
        await this.request('DELETE', `/api/profiles/${encodeURIComponent(id)}`);
    }

    subscribeProfile(id, { onUpdate }) {
        if (!this.token) return () => {};
        this.ensureSocket();
        if (!this.socketSubscribers.profile.has(id)) this.socketSubscribers.profile.set(id, new Set());
        const entry = { onUpdate };
        this.socketSubscribers.profile.get(id).add(entry);
        this.socket.emit('subscribe:profile', { profileId: id });
        return () => {
            const set = this.socketSubscribers.profile.get(id);
            if (set) set.delete(entry);
        };
    }

    // changes: [{ type: 'added'|'modified'|'removed', data }] — the socket only ever emits
    // on real server-side changes, so there is no Firestore-style "settled empty snapshot"
    // case to account for; the caller can rely purely on whether `changes` is non-empty.
    subscribeProfilesCollection({ onDocChanges }) {
        if (!this.token) return () => {};
        this.ensureSocket();
        this.socketSubscribers.profiles.add(onDocChanges);
        this.socket.emit('subscribe:profiles');
        return () => this.socketSubscribers.profiles.delete(onDocChanges);
    }

    async logActivity(logEntry) {
        await this.request('POST', '/api/audit-logs', logEntry);
    }

    async getAuditLogs(limitCount = 50) {
        const result = await this.request('GET', `/api/audit-logs?limit=${limitCount}`);
        return result.logs || [];
    }
}

module.exports = SelfHostedProvider;
