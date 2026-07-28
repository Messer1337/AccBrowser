// Idempotent first-admin seeding — the self-hosted equivalent of manually granting a
// uid the 'admin' role in the Firebase Console for a clean box. Safe to run on every
// container start: it only inserts when ADMIN_USERNAME does not already exist.
const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth/password');

async function main() {
    const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!password) {
        console.log('[bootstrap-admin] ADMIN_PASSWORD not set — skipping.');
        return;
    }
    if (password.length < 12 || password.length > 256 || password.toLowerCase() === 'admin') {
        throw new Error('ADMIN_PASSWORD must be 12-256 characters and cannot be "admin".');
    }

    const { rows } = await pool.query('SELECT username FROM users WHERE username=$1', [username]);
    if (rows.length) {
        console.log(`[bootstrap-admin] '${username}' already exists — skipping.`);
        return;
    }

    const now = Date.now();
    await pool.query(
        'INSERT INTO users (username, role, allowed_profiles, password_hash, must_change_password, created_at, updated_at) VALUES ($1,$2,$3,$4,false,$5,$5)',
        [username, 'admin', JSON.stringify(['*']), hashPassword(password), now]
    );
    console.log(`[bootstrap-admin] Created admin user '${username}'.`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[bootstrap-admin]', err.message);
        process.exit(1);
    });
