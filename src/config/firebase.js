const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { getAuth, connectAuthEmulator } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator } = require('firebase/functions');

let db = null;
let auth = null;
let secondaryAuth = null;
let functions = null;
let isConfigured = false;
let currentConfig = null;
let emulatorsConnected = false;

const useFirebaseEmulators = process.env.OASIS_USE_FIREBASE_EMULATORS === '1';
const emulatorHost = process.env.OASIS_FIREBASE_EMULATOR_HOST || '127.0.0.1';
const emulatorPorts = {
    firestore: Number(process.env.OASIS_FIRESTORE_EMULATOR_PORT || 8087),
    auth: Number(process.env.OASIS_AUTH_EMULATOR_PORT || 9099),
    functions: Number(process.env.OASIS_FUNCTIONS_EMULATOR_PORT || 5001)
};

const userFirebaseConfig = {
    apiKey: "AIzaSyAb9QYo5GupuDVHOH2nW1dP3fu1VgE5k4o",
    authDomain: "accbrowser.firebaseapp.com",
    projectId: "accbrowser",
    storageBucket: "accbrowser.firebasestorage.app",
    messagingSenderId: "1024521590796",
    appId: "1:1024521590796:web:6d999d1585b6446183f629"
};

function initFirebase(customConfig = null) {
    const config = customConfig || currentConfig || userFirebaseConfig;

    if (config.apiKey && config.apiKey !== "YOUR_API_KEY" && config.projectId !== "YOUR_PROJECT_ID") {
        try {
            const app = getApps().find(a => a.name === '[DEFAULT]') || initializeApp(config);
            db = getFirestore(app);
            auth = getAuth(app);
            functions = getFunctions(app);

            // Separate app instance so provisioning a *different* user's Firebase Auth
            // account (admin adding a teammate) never disturbs the currently signed-in session.
            const secondaryApp = getApps().find(a => a.name === 'Secondary') || initializeApp(config, 'Secondary');
            secondaryAuth = getAuth(secondaryApp);

            if (useFirebaseEmulators && !emulatorsConnected) {
                connectFirestoreEmulator(db, emulatorHost, emulatorPorts.firestore);
                connectAuthEmulator(auth, `http://${emulatorHost}:${emulatorPorts.auth}`, { disableWarnings: true });
                connectAuthEmulator(secondaryAuth, `http://${emulatorHost}:${emulatorPorts.auth}`, { disableWarnings: true });
                connectFunctionsEmulator(functions, emulatorHost, emulatorPorts.functions);
                emulatorsConnected = true;
                console.log('[Firebase] Local Emulator Suite mode enabled.');
            }

            isConfigured = true;
            currentConfig = config;
            console.log('[Firebase] Cloud Firestore initialized successfully.');
        } catch (error) {
            console.warn('[Firebase] Initialization error:', error.message);
            isConfigured = false;
        }
    } else {
        console.log('[Firebase] Using local storage mode until valid Firebase credentials are set.');
        isConfigured = false;
    }
    return { db, isConfigured };
}

module.exports = {
    initFirebase,
    getDb: () => db,
    getAuthInstance: () => auth,
    getSecondaryAuthInstance: () => secondaryAuth,
    getFunctionsInstance: () => functions,
    isFirebaseConfigured: () => isConfigured,
    getFirebaseMode: () => {
        if (!isConfigured) return 'Локальний режим';
        return useFirebaseEmulators ? 'Firebase Emulator (локально)' : 'Firebase Cloud Sync';
    }
};
