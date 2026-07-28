// Shared vocabulary for the two BackendProvider implementations (FirebaseProvider,
// SelfHostedProvider). Both throw plain Error objects whose `.code` is one of these
// strings, so every existing `err.code === 'permission-denied'` check in auth-manager.js
// and sync-manager.js keeps working unchanged regardless of which backend is active.
const ERROR_CODES = {
    UNAUTHENTICATED: 'unauthenticated',
    PERMISSION_DENIED: 'permission-denied',
    NOT_FOUND: 'not-found',
    FAILED_PRECONDITION: 'failed-precondition',
    RESOURCE_EXHAUSTED: 'resource-exhausted',
    INVALID_ARGUMENT: 'invalid-argument',
    UNAVAILABLE: 'unavailable'
};

function backendError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// Sentinel meaning "remove this field" for provider write calls (mirrors Firestore's
// deleteField()/FieldValue.delete()). FirebaseProvider maps it to the real Firestore
// sentinel internally; SelfHostedProvider's schema never carries the legacy field this
// is used for (passwordHash on a team-user record), so it treats UNSET as a no-op.
const UNSET = Symbol('backend-provider-unset-field');

/**
 * @typedef {Object} BackendProvider
 * Every method below is implemented by both FirebaseProvider and SelfHostedProvider.
 *
 * -- lifecycle --
 * isConfigured(): boolean
 * getMode(): string                          // UI display string
 *
 * -- auth --
 * login(username, password): Promise<{ authenticated: false } | { authenticated: true, uid: string, role: string, allowedProfiles: string[], firebaseUid: string }>
 *   Never throws for "could not authenticate this attempt" (offline / stale local
 *   password / not yet provisioned) — resolves { authenticated: false } and the caller
 *   keeps using cached local data. Throws a backendError('not-found'|'permission-denied', ...)
 *   only once authentication itself succeeded but the team-user record lookup failed in
 *   a way the caller must react to (revoke detection).
 * logout(): Promise<void>
 * changeOwnPassword(newPassword): Promise<void>   // rotates only the currently authenticated identity
 * subscribeCurrentUser(username, { onExists, onMissing, onPermissionDenied, onOtherError }): () => void
 *   Live listener mirroring onSnapshot(teamUsers/{username}). Returns an unsubscribe fn.
 *
 * -- team users (admin) --
 * upsertTeamUser({ username, role, allowedProfiles, password }): Promise<{ uid: string }>
 * deleteTeamUser(username): Promise<void>
 * listTeamUsers(): Promise<Array<{ username, role, allowedProfiles, firebaseUid }>>
 *
 * -- profiles --
 * getProfile(id): Promise<object|null>
 * listProfiles(): Promise<object[]>            // admin-only full collection fetch
 * saveProfileFull(id, cleanData, expectedRevision): Promise<{ revision, updatedAt, updatedBy }>
 * syncProfileSession(id, { deviceId, cookies, expectedRevision }): Promise<{ revision, updatedAt, updatedBy }>
 * ensureProfileFingerprint(id, { fingerprint, fingerprintHeaders }): Promise<{ fingerprint, fingerprintHeaders, fingerprintUpdatedAt, revision } | null>
 * claimProfileLease(id, deviceId): Promise<{ activeHolder }>
 * heartbeatProfileLease(id, deviceId): Promise<{ activeHolder }>
 * releaseProfileLease(id, deviceId): Promise<{ activeHolder: null }>
 * deleteProfile(id): Promise<void>
 * subscribeProfile(id, onRemoteUpdate): () => void
 * subscribeProfilesCollection(onChanged): () => void
 *
 * -- audit --
 * logActivity(entry): Promise<void>
 * getAuditLogs(limitCount): Promise<object[]>
 */

module.exports = { ERROR_CODES, backendError, UNSET };
