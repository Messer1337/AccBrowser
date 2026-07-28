exports.up = (pgm) => {
    pgm.createTable('users', {
        username: { type: 'text', primaryKey: true },
        role: { type: 'text', notNull: true },
        allowed_profiles: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
        password_hash: { type: 'text', notNull: true },
        must_change_password: { type: 'boolean', notNull: true, default: false },
        created_at: { type: 'bigint' },
        updated_at: { type: 'bigint' }
    });
    pgm.addConstraint('users', 'users_role_check', "CHECK (role IN ('admin', 'user'))");

    pgm.createTable('profiles', {
        id: { type: 'text', primaryKey: true },
        name: { type: 'text' },
        url: { type: 'text' },
        proxy: { type: 'text' },
        user_agent: { type: 'text' },
        timezone: { type: 'text' },
        cookies: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
        fingerprint: { type: 'jsonb' },
        fingerprint_headers: { type: 'jsonb' },
        fingerprint_updated_at: { type: 'bigint' },
        active_holder: { type: 'jsonb' },
        revision: { type: 'integer', notNull: true, default: 0 },
        updated_by: { type: 'text' },
        updated_at: { type: 'bigint' },
        last_sync_user: { type: 'text' },
        last_sync_device: { type: 'text' }
    });

    pgm.createTable('audit_logs', {
        id: 'id',
        action: { type: 'text' },
        username: { type: 'text' },
        profile_id: { type: 'text' },
        profile_name: { type: 'text' },
        details: { type: 'text' },
        device_id: { type: 'text' },
        timestamp: { type: 'bigint' }
    });
    pgm.createIndex('audit_logs', 'timestamp');
};

exports.down = (pgm) => {
    pgm.dropTable('audit_logs');
    pgm.dropTable('profiles');
    pgm.dropTable('users');
};
