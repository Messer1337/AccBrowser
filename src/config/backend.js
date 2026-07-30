const path = require('path');
const fs = require('fs-extra');
const { initFirebase } = require('./firebase');
const FirebaseProvider = require('../main/backend/firebase-provider');
const SelfHostedProvider = require('../main/backend/selfhosted-provider');

function loadConfig() {
    let mode = process.env.OASIS_BACKEND;
    let url = process.env.OASIS_SELFHOSTED_URL;

    const configPaths = [
        path.join(process.cwd(), 'oasis_config.json'),
        path.join(__dirname, '../../oasis_config.json')
    ];

    try {
        const { app } = require('electron');
        if (app && app.getPath) {
            configPaths.unshift(path.join(app.getPath('userData'), 'oasis_config.json'));
        }
    } catch (e) {
        // electron app module might not be ready in CLI tests
    }

    for (const p of configPaths) {
        if (fs.existsSync(p)) {
            try {
                const cfg = fs.readJsonSync(p);
                if (!mode && cfg.backend) mode = cfg.backend;
                if (!url && cfg.selfhostedUrl) url = cfg.selfhostedUrl;
            } catch (err) {
                console.warn('[BackendConfig] Failed to parse', p, err.message);
            }
        }
    }

    // Out-of-the-box default: Self-Hosted mode pointing to production server
    if (!mode) mode = 'selfhosted';
    if (!url) url = 'http://152.53.224.55:3300';

    return { mode, url };
}

let activeMode = 'selfhosted';
let provider = null;

function initBackend(customFirebaseConfig = null) {
    const { mode, url } = loadConfig();
    activeMode = mode;

    if (mode === 'selfhosted') {
        provider = new SelfHostedProvider({
            baseUrl: url
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
    return activeMode;
}

module.exports = { initBackend, getBackendProvider, getBackendMode };
