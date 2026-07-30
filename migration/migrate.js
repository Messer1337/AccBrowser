#!/usr/bin/env node
// One-off tool: copies existing Firestore data (teamUsers, profiles, auditLogs) into the
// self-hosted Postgres schema (see ../server). Safe to re-run (upserts by primary key).
//
// What this does NOT do:
// - Migrate passwords. Firebase Auth never exposes a user's real password or a hash this
//   server could verify against — only Google's own servers can check it. Every migrated
//   account gets a random temporary password (printed once, at the end) and
//   must_change_password=true, so the person is forced to set a real one on first login.
// - Touch your Firebase project. This only reads from it.
const crypto = require('crypto');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { Pool } = require('pg');

const dryRun = process.argv.includes('--dry-run');

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing required env var ${name}. See migration/README.md.`);
        process.exit(1);
    }
    return value;
}

const serviceAccountPath = requireEnv('FIREBASE_SERVICE_ACCOUNT_PATH');
const databaseUrl = requireEnv('DATABASE_URL');

initializeApp({ credential: cert(path.resolve(serviceAccountPath)) });
const db = getFirestore();
const pool = new Pool({ connectionString: databaseUrl });

// Identical to server/src/auth/password.js and the Electron client's local verifier, so a
// migrated row is indistinguishable from one created normally.
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function randomTempPassword() {
    return crypto.randomBytes(20).toString('base64url').slice(0, 24);
}

// A temporary password is only ever assigned to a username the FIRST time this script
// creates its row. Re-running later (e.g. to pick up a newly added teammate, or an ACL
// change made in Firebase since) must never touch password_hash/must_change_password for
// an already-migrated account — otherwise it would silently overwrite a real password
// someone already chose with a new random one and force them to change it again.
async function migrateTeamUsers() {
    const snapshot = await db.collection('teamUsers').get();
    const credentials = [];
    let newCount = 0;
    let updatedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const username = String(data.username || doc.id).toLowerCase();
        const role = data.role === 'admin' ? 'admin' : 'user';
        const allowedProfiles = role === 'admin' ? ['*'] : (Array.isArray(data.allowedProfiles) ? data.allowedProfiles : []);

        if (dryRun) {
            newCount++; // dry-run can't know which are new without writing; treat all as "would touch"
            continue;
        }

        const now = Date.now();
        const { rows: existingRows } = await pool.query('SELECT username FROM users WHERE username=$1', [username]);

        if (existingRows.length > 0) {
            await pool.query(
                'UPDATE users SET role=$1, allowed_profiles=$2, updated_at=$3 WHERE username=$4',
                [role, JSON.stringify(allowedProfiles), now, username]
            );
            updatedCount++;
        } else {
            const tempPassword = randomTempPassword();
            credentials.push({ username, tempPassword });
            await pool.query(
                `INSERT INTO users (username, role, allowed_profiles, password_hash, must_change_password, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,true,$5,$5)`,
                [username, role, JSON.stringify(allowedProfiles), hashPassword(tempPassword), now]
            );
            newCount++;
        }
    }
    return { count: snapshot.docs.length, newCount, updatedCount, credentials };
}

async function migrateProfiles() {
    const snapshot = await db.collection('profiles').get();
    for (const doc of snapshot.docs) {
        const data = doc.data();
        const id = data.id || doc.id;
        if (dryRun) continue;

        await pool.query(
            `INSERT INTO profiles (
                 id, name, url, proxy, user_agent, timezone, cookies, fingerprint, fingerprint_headers,
                 fingerprint_updated_at, active_holder, revision, updated_by, updated_at, last_sync_user, last_sync_device
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13,$14,$15)
             ON CONFLICT (id) DO UPDATE SET
               name=EXCLUDED.name, url=EXCLUDED.url, proxy=EXCLUDED.proxy, user_agent=EXCLUDED.user_agent,
               timezone=EXCLUDED.timezone, cookies=EXCLUDED.cookies, fingerprint=EXCLUDED.fingerprint,
               fingerprint_headers=EXCLUDED.fingerprint_headers, fingerprint_updated_at=EXCLUDED.fingerprint_updated_at,
               active_holder=NULL, revision=EXCLUDED.revision, updated_by=EXCLUDED.updated_by,
               updated_at=EXCLUDED.updated_at, last_sync_user=EXCLUDED.last_sync_user, last_sync_device=EXCLUDED.last_sync_device`,
            [
                id,
                data.name || '',
                data.url || '',
                data.proxy || '',
                data.userAgent || '',
                data.timezone || '',
                JSON.stringify(data.cookies || []),
                JSON.stringify(data.fingerprint || null),
                JSON.stringify(data.fingerprintHeaders || {}),
                data.fingerprintUpdatedAt || null,
                // active_holder is deliberately NOT carried over: the self-hosted server has
                // no way to know whether whatever device held a Firestore lease is still
                // running, and a stale lease would lock everyone else out of the profile.
                Number.isInteger(data.revision) ? data.revision : 0,
                data.updatedBy || null,
                data.updatedAt || Date.now(),
                data.lastSyncUser || null,
                data.lastSyncDevice || null
            ]
        );
    }
    return snapshot.docs.length;
}

// Unlike users/profiles, audit_logs has no natural upsert key (it's a bigserial PK, not
// keyed by the Firestore document id), so a plain INSERT would duplicate every entry on
// a second run. Since this table is an append-only historical record rather than live
// state, the simplest correct rule is: only import history once. If you re-run this
// script later to pick up newly-added users/profiles, it will not re-touch audit_logs.
async function migrateAuditLogs() {
    if (!dryRun) {
        const { rows } = await pool.query('SELECT COUNT(*) FROM audit_logs');
        if (Number(rows[0].count) > 0) {
            console.log(`auditLogs:  table already has ${rows[0].count} row(s) — skipping (only migrated on a table's first run).`);
            return null;
        }
    }

    const snapshot = await db.collection('auditLogs').orderBy('timestamp', 'asc').get();
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (dryRun) continue;

        await pool.query(
            `INSERT INTO audit_logs (action, username, profile_id, profile_name, details, device_id, timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
                data.action || 'UNKNOWN_ACTION',
                data.username || 'system',
                data.profileId || null,
                data.profileName || null,
                data.details || '',
                data.deviceId || null,
                data.timestamp || Date.now()
            ]
        );
    }
    return snapshot.docs.length;
}

async function main() {
    console.log(dryRun ? 'DRY RUN — no writes will be made.\n' : 'LIVE RUN — writing to Postgres.\n');

    const { count: userCount, newCount, updatedCount, credentials } = await migrateTeamUsers();
    if (dryRun) {
        console.log(`teamUsers:  ${userCount} account(s) found (dry run can't tell new vs. already-migrated without writing).`);
    } else {
        console.log(`teamUsers:  ${newCount} new account(s) created (temp password issued), ${updatedCount} existing account(s) had role/ACL refreshed only.`);
    }

    const profileCount = await migrateProfiles();
    console.log(`profiles:   ${profileCount} profile(s)${dryRun ? ' would be' : ''} migrated (active leases cleared).`);

    const logCount = await migrateAuditLogs();
    if (logCount !== null) {
        console.log(`auditLogs:  ${logCount} entr${logCount === 1 ? 'y' : 'ies'}${dryRun ? ' would be' : ''} migrated.`);
    }

    if (!dryRun && credentials.length > 0) {
        console.log('\n=== TEMPORARY PASSWORDS — distribute out-of-band, then clear this terminal ===');
        for (const { username, tempPassword } of credentials) {
            console.log(`${username}\t${tempPassword}`);
        }
        console.log('\nEach account above has must_change_password set — the app will force them');
        console.log('to set a real password on first login with the temporary one.');
    }

    await pool.end();
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
