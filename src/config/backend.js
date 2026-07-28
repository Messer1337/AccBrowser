const { initFirebase, isFirebaseConfigured, getFirebaseMode } = require('./firebase');
const FirebaseProvider = require('../main/backend/firebase-provider');
const SelfHostedProvider = require('../main/backend/selfhosted-provider');

const mode = process.env.OASIS_BACKEND === 'selfhosted' ? 'selfhosted' : 'firebase';
let provider = null;

// Deliberately not hot-swappable: switching backends mid-session while browsers hold
// active leases is out of scope. Read once at startup, same as OASIS_USER_DATA_DIR.
function initBackend(customFirebaseConfig = null) {
    if (mode === 'selfhosted') {
        provider = new SelfHostedProvider({
            baseUrl: process.env.OASIS_SELFHOSTED_URL || 'http://127.0.0.1:3000'
        });
    } else {
        initFirebase(customFirebaseConfig);
        provider = new FirebaseProvider();
    }
    return provider;
}

function getBackendProvider() {
    if (!provider) initBackend();
    return provider;
}

function getBackendMode() {
    return mode;
}

module.exports = { initBackend, getBackendProvider, getBackendMode };
