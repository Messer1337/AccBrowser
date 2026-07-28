const fs = require('fs');
const path = require('path');
const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, setDoc } = require('firebase/firestore');

const projectId = 'oasis-rules-test';
const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

function profile(id, overrides = {}) {
    return {
        id,
        name: `Profile ${id}`,
        url: 'https://example.com/',
        proxy: '',
        userAgent: '',
        timezone: 'Europe/Kyiv',
        cookies: [],
        revision: 1,
        updatedBy: 'admin',
        updatedAt: Date.now(),
        lastSyncUser: 'admin',
        lastSyncDevice: 'device_seed',
        ...overrides
    };
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId,
        firestore: { rules }
    });

    try {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'authorizedUsers', 'admin_uid'), {
                username: 'admin', role: 'admin', allowedProfiles: ['*']
            });
            await setDoc(doc(db, 'authorizedUsers', 'worker_uid'), {
                username: 'worker', role: 'user', allowedProfiles: ['allowed_profile']
            });
            await setDoc(doc(db, 'authorizedUsers', 'other_worker_uid'), {
                username: 'other', role: 'user', allowedProfiles: []
            });
            await setDoc(doc(db, 'profiles', 'allowed_profile'), profile('allowed_profile'));
            await setDoc(doc(db, 'profiles', 'private_profile'), profile('private_profile'));
        });

        const admin = testEnv.authenticatedContext('admin_uid').firestore();
        const worker = testEnv.authenticatedContext('worker_uid').firestore();
        const outsider = testEnv.authenticatedContext('other_worker_uid').firestore();

        await assertSucceeds(getDoc(doc(worker, 'profiles', 'allowed_profile')));
        await assertFails(getDoc(doc(worker, 'profiles', 'private_profile')));
        await assertFails(getDoc(doc(outsider, 'profiles', 'allowed_profile')));
        await assertFails(getDocs(collection(worker, 'profiles')));
        await assertSucceeds(getDocs(collection(admin, 'profiles')));

        // Direct SDK writes from non-admins are forbidden even for profiles they can read.
        await assertFails(setDoc(doc(worker, 'profiles', 'allowed_profile'), { cookies: [{ name: 'x' }] }, { merge: true }));

        // Admin writes must satisfy the Rules allowlist; unknown fields are rejected.
        await assertFails(setDoc(doc(admin, 'profiles', 'allowed_profile'), { unexpectedPayload: true }, { merge: true }));
        await assertSucceeds(setDoc(doc(admin, 'profiles', 'allowed_profile'), { name: 'Renamed profile' }, { merge: true }));

        console.log('Firestore Emulator Rules tests: ok');
    } finally {
        await testEnv.cleanup();
    }
}

main().catch((error) => {
    console.error('Firestore Emulator Rules tests failed:', error);
    process.exitCode = 1;
});
