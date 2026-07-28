const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Direct analog of Firestore's transaction.get/transaction.set: a row-level lock held
// for the duration of the callback, so lease/revision checks and their follow-up write
// are atomic. Sufficient at this scale since cookie syncs are already debounced 1.5s +
// hash-gated client-side, so real contention on a single profile row is rare.
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, withTransaction };
