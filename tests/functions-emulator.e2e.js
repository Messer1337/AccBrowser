const assert = require('assert');
const path = require('path');
const { createRequire } = require('module');
const functionsRequire = createRequire(path.join(__dirname, '../functions/package.json'));
const { initializeApp: initializeAdminApp, getApps } = functionsRequire('firebase-admin/app');
const { getAuth: getAdminAuth } = functionsRequire('firebase-admin/auth');
const { getFirestore: getAdminFirestore } = functionsRequire('firebase-admin/firestore');
const { initializeApp, deleteApp } = require('firebase/app');
const { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require('firebase/functions');

const projectId = 'oasis-functions-test';
const config = {
    apiKey: 'emulator-only-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: '1:000000000000:web:emulatoronly'
};

function profile(id) {
    return {
        id,
        name: 'Functions E2E profile',
        url: 'https://example.com/',
        proxy: '',
        userAgent: '',
        timezone: 'Europe/Kyiv',
        cookies: [],
        revision: 0,
        updatedBy: 'seed',
        updatedAt: Date.now(),
        lastSyncUser: 'seed',
        lastSyncDevice: 'seed-device'
    };
}

async function expectCallableFailure(callable, expectedCode) {
    await assert.rejects(callable, (error) => error && error.code === expectedCode);
}

async function main() {
    if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        throw new Error('Тест має запускатися лише через Firebase Emulators.');
    }

    const adminApp = getApps().find(app => app.name === 'functions-e2e')
        || initializeAdminApp({ projectId }, 'functions-e2e');
    const adminAuth = getAdminAuth(adminApp);
    const adminDb = getAdminFirestore(adminApp);

    const adminUser = await adminAuth.createUser({
        uid: 'admin_uid', email: 'admin@oasis-test.local', password: 'Admin test password 2026'
    });
    const workerUser = await adminAuth.createUser({
        uid: 'worker_uid', email: 'worker@oasis-test.local', password: 'Worker test password 2026'
    });
    const outsiderUser = await adminAuth.createUser({
        uid: 'outsider_uid', email: 'outsider@oasis-test.local', password: 'Outsider test password 2026'
    });
    assert.equal(adminUser.uid, 'admin_uid');
    assert.equal(workerUser.uid, 'worker_uid');
    assert.equal(outsiderUser.uid, 'outsider_uid');

    await adminDb.doc('authorizedUsers/admin_uid').set({ username: 'admin', role: 'admin', allowedProfiles: ['*'] });
    await adminDb.doc('authorizedUsers/worker_uid').set({ username: 'worker', role: 'user', allowedProfiles: ['profile_1'] });
    await adminDb.doc('authorizedUsers/outsider_uid').set({ username: 'outsider', role: 'user', allowedProfiles: [] });
    await adminDb.doc('profiles/profile_1').set(profile('profile_1'));

    const app = initializeApp(config, 'functions-e2e-client');
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    const functions = getFunctions(app);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);

    const call = (name, data) => httpsCallable(functions, name)(data);

    await signInWithEmailAndPassword(auth, 'admin@oasis-test.local', 'Admin test password 2026');
    const provisioned = await call('upsertTeamUser', {
        username: 'new.worker', role: 'user', allowedProfiles: ['profile_1'], password: 'New worker password 2026'
    });
    assert.equal(provisioned.data.success, true);
    const newWorkerAcl = await adminDb.doc(`authorizedUsers/${provisioned.data.firebaseUid}`).get();
    assert.equal(newWorkerAcl.get('role'), 'user');
    assert.deepEqual(newWorkerAcl.get('allowedProfiles'), ['profile_1']);
    assert.equal((await adminDb.doc('teamUsers/new.worker').get()).get('passwordHash'), undefined);
    await signOut(auth);

    await signInWithEmailAndPassword(auth, 'worker@oasis-test.local', 'Worker test password 2026');
    const lease = await call('claimProfileLease', { profileId: 'profile_1', deviceId: 'device_worker_123' });
    assert.equal(lease.data.activeHolder.deviceId, 'device_worker_123');
    const session = await call('syncProfileSession', {
        profileId: 'profile_1', deviceId: 'device_worker_123', expectedRevision: 0,
        cookies: [{ name: 'session', value: 'emulator-only', domain: '.example.com', path: '/' }]
    });
    assert.equal(session.data.success, true);
    assert.equal(session.data.revision, 1);
    await expectCallableFailure(
        () => call('syncProfileSession', { profileId: 'profile_1', deviceId: 'device_worker_123', expectedRevision: 0, cookies: [] }),
        'functions/failed-precondition'
    );
    await call('releaseProfileLease', { profileId: 'profile_1', deviceId: 'device_worker_123' });
    assert.equal((await adminDb.doc('profiles/profile_1').get()).get('activeHolder'), null);
    await signOut(auth);

    await signInWithEmailAndPassword(auth, 'outsider@oasis-test.local', 'Outsider test password 2026');
    await expectCallableFailure(
        () => call('claimProfileLease', { profileId: 'profile_1', deviceId: 'device_outsider_123' }),
        'functions/permission-denied'
    );
    await signOut(auth);
    await deleteApp(app);
    console.log('Functions Emulator end-to-end tests: ok');
}

main().catch((error) => {
    console.error('Functions Emulator end-to-end tests failed:', error);
    process.exitCode = 1;
});
