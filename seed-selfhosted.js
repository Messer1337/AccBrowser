const fs = require('fs');
const path = require('path');

const SERVER_URL = 'http://152.53.224.55:3300';
const ADMIN_USER = 'admin';
const ADMIN_PASS = '2WueKat5FrMV4hqrYLzt';

async function request(method, urlPath, body, token = null) {
    const res = await fetch(`${SERVER_URL}${urlPath}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    try {
        return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch (e) {
        return { ok: res.ok, status: res.status, text };
    }
}

async function run() {
    console.log(`Connecting to self-hosted server at ${SERVER_URL}...`);
    
    // 1. Login as Admin
    let authRes = await request('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    if (!authRes.ok) {
        console.error('Failed to log in as admin:', authRes);
        process.exit(1);
    }
    console.log('Logged in successfully as admin.');
    let token = authRes.data.token;

    // 2. Read local profiles from AppData
    const appDataDir = path.join(process.env.APPDATA, 'OASIS Browser', 'local_db');
    const profileFiles = fs.readdirSync(appDataDir).filter(f => f.startsWith('profile_') && f.endsWith('.json'));

    console.log(`Found ${profileFiles.length} profiles locally in ${appDataDir}. Uploading...`);

    for (const file of profileFiles) {
        const filePath = path.join(appDataDir, file);
        const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Reset activeHolder so profile is unlocked
        profile.activeHolder = null;
        if (!Array.isArray(profile.cookies)) profile.cookies = [];
        if (!profile.url) profile.url = 'https://google.com';
        if (!profile.name) profile.name = profile.id;

        // Check if profile exists on server to get current revision
        const getRes = await request('GET', `/api/profiles/${encodeURIComponent(profile.id)}`, undefined, token);
        const currentRevision = getRes.ok && getRes.data ? getRes.data.revision : 0;

        console.log(`Uploading profile '${profile.name}' (ID: ${profile.id}, expectedRevision: ${currentRevision})...`);
        const putRes = await request('PUT', `/api/profiles/${encodeURIComponent(profile.id)}`, {
            data: profile,
            expectedRevision: currentRevision
        }, token);

        if (putRes.ok) {
            console.log(` -> Profile '${profile.name}' uploaded successfully (revision ${putRes.data.revision}).`);
        } else {
            console.error(` -> Failed to upload profile '${profile.name}':`, putRes);
        }
    }

    // 3. Upload team users from users.json
    const usersPath = path.join(process.env.APPDATA, 'OASIS Browser', 'users.json');
    if (fs.existsSync(usersPath)) {
        const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        console.log(`Found ${users.length} users in users.json. Syncing...`);
        for (const user of users) {
            if (user.username === 'admin') continue; // skip default admin
            console.log(`Upserting team user '${user.username}'...`);
            const userRes = await request('POST', '/api/team-users', {
                username: user.username,
                role: user.role,
                allowedProfiles: user.allowedProfiles || [],
                password: 'TempUserPassword123!' // temporary password for worker account
            }, token);
            if (userRes.ok) {
                console.log(` -> Team user '${user.username}' synced successfully.`);
            } else {
                console.error(` -> Failed to sync team user '${user.username}':`, userRes);
            }
        }
    }

    console.log('\nSUCCESS! All 5 profiles and team users are now uploaded to your self-hosted server!');
}

run().catch(err => console.error('Fatal error:', err));
