const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth/password');

let app;

before(async () => {
    app = createApp();
    const now = Date.now();
    await pool.query('DELETE FROM audit_logs');
    await pool.query('DELETE FROM profiles');
    await pool.query('DELETE FROM users');
    await pool.query(
        'INSERT INTO users (username, role, allowed_profiles, password_hash, must_change_password, created_at, updated_at) VALUES ($1,$2,$3,$4,false,$5,$5)',
        ['admin', 'admin', JSON.stringify(['*']), hashPassword('AdminPassword123!'), now]
    );
    await pool.query(
        'INSERT INTO users (username, role, allowed_profiles, password_hash, must_change_password, created_at, updated_at) VALUES ($1,$2,$3,$4,false,$5,$5)',
        ['worker', 'user', JSON.stringify(['profile_a']), hashPassword('WorkerPassword123!'), now]
    );
});

after(async () => {
    await pool.end();
});

async function loginAs(username, password) {
    const res = await request(app).post('/api/auth/login').send({ username, password });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.token;
}

test('non-admin cannot create/edit a profile via full metadata save', async () => {
    const token = await loginAs('worker', 'WorkerPassword123!');
    const res = await request(app).put('/api/profiles/profile_a')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: { name: 'A', url: 'https://example.com', cookies: [] }, expectedRevision: 0 });
    assert.equal(res.status, 403);
});

test('admin can create a profile and a stale expectedRevision is rejected as a conflict', async () => {
    const adminToken = await loginAs('admin', 'AdminPassword123!');
    const create = await request(app).put('/api/profiles/profile_a')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ data: { name: 'A', url: 'https://example.com', cookies: [] }, expectedRevision: 0 });
    assert.equal(create.status, 200);
    assert.equal(create.body.revision, 1);

    const stale = await request(app).put('/api/profiles/profile_a')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ data: { name: 'A2', url: 'https://example.com', cookies: [] }, expectedRevision: 0 });
    assert.equal(stale.status, 409);
});

test('a worker can read only the profile explicitly allowed to them', async () => {
    const token = await loginAs('worker', 'WorkerPassword123!');
    const ok = await request(app).get('/api/profiles/profile_a').set('Authorization', `Bearer ${token}`);
    assert.equal(ok.status, 200);
    const denied = await request(app).get('/api/profiles/profile_b').set('Authorization', `Bearer ${token}`);
    assert.equal(denied.status, 403);
});

test('session-sync requires a live lease held by the exact same device', async () => {
    const token = await loginAs('worker', 'WorkerPassword123!');

    const noLease = await request(app).post('/api/profiles/profile_a/session-sync')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceId: 'device_aaaaaaaa', cookies: [], expectedRevision: 1 });
    assert.equal(noLease.status, 409);

    const claim = await request(app).post('/api/profiles/profile_a/lease/claim')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceId: 'device_aaaaaaaa' });
    assert.equal(claim.status, 200);

    const wrongDevice = await request(app).post('/api/profiles/profile_a/session-sync')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceId: 'device_bbbbbbbb', cookies: [], expectedRevision: 1 });
    assert.equal(wrongDevice.status, 409);

    const ok = await request(app).post('/api/profiles/profile_a/session-sync')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceId: 'device_aaaaaaaa', cookies: [{ name: 'x', value: '1' }], expectedRevision: 1 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.revision, 2);
});

test('an oversized cookies payload is rejected rather than silently truncated', async () => {
    const token = await loginAs('worker', 'WorkerPassword123!');
    const bigCookies = [{ value: 'x'.repeat(710000) }];
    const res = await request(app).post('/api/profiles/profile_a/session-sync')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceId: 'device_aaaaaaaa', cookies: bigCookies, expectedRevision: 2 });
    assert.equal(res.status, 413);
});

test('an oversized fingerprint payload is rejected', async () => {
    const token = await loginAs('worker', 'WorkerPassword123!');
    const res = await request(app).post('/api/profiles/profile_a/fingerprint')
        .set('Authorization', `Bearer ${token}`)
        .send({ fingerprint: { blob: 'x'.repeat(60000) } });
    assert.equal(res.status, 413);
});

test('a second device cannot claim a lease already held by another live device', async () => {
    const token = await loginAs('worker', 'WorkerPassword123!');
    const res = await request(app).post('/api/profiles/profile_a/lease/claim')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceId: 'device_cccccccc' });
    assert.equal(res.status, 409);
});

test('a revoked user is rejected on the very next login attempt', async () => {
    const adminToken = await loginAs('admin', 'AdminPassword123!');
    const del = await request(app).delete('/api/team-users/worker').set('Authorization', `Bearer ${adminToken}`);
    assert.equal(del.status, 200);

    const res = await request(app).post('/api/auth/login').send({ username: 'worker', password: 'WorkerPassword123!' });
    assert.equal(res.status, 404);
});
