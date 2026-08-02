// Idempotent first-admin seeding — the self-hosted equivalent of manually granting a
// uid the 'admin' role in the Firebase Console for a clean box. Safe to run on every
// container start: it only inserts when ADMIN_USERNAME does not already exist.
const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth/password');

async function main() {
    const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    let password = process.env.ADMIN_PASSWORD;
    let mustChangePassword = false;

    if (!password) {
        password = 'admin12345678';
        mustChangePassword = true;
        console.log('[bootstrap-admin] ADMIN_PASSWORD не вказано в .env — створюємо початкового адміна з тимчасовим паролем (потрібна зміна при першому вході).');
    }

    if (password.length < 12 || password.length > 256 || password.toLowerCase() === 'admin') {
        throw new Error('ADMIN_PASSWORD має містити від 12 до 256 символів і не бути "admin".');
    }

    const { rows } = await pool.query("SELECT username FROM users WHERE role='admin' OR username=$1", [username]);
    if (rows.length) {
        console.log(`[bootstrap-admin] Адміністратора '${rows[0].username}' вже створено — пропускаємо ініціалізацію.`);
        return;
    }

    const now = Date.now();
    await pool.query(
        'INSERT INTO users (username, role, allowed_profiles, password_hash, must_change_password, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)',
        [username, 'admin', JSON.stringify(['*']), hashPassword(password), mustChangePassword, now]
    );
    console.log(`[bootstrap-admin] Створено єдиного адміністратора '${username}'.`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[bootstrap-admin]', err.message);
        process.exit(1);
    });
