const { initializeApp, getApps } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const { getAuth } = require('firebase/auth');

let db = null;
let auth = null;
let secondaryAuth = null;
let isConfigured = false;
let currentConfig = null;

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

            // Separate app instance so provisioning a *different* user's Firebase Auth
            // account (admin adding a teammate) never disturbs the currently signed-in session.
            const secondaryApp = getApps().find(a => a.name === 'Secondary') || initializeApp(config, 'Secondary');
            secondaryAuth = getAuth(secondaryApp);

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
    isFirebaseConfigured: () => isConfigured
};
