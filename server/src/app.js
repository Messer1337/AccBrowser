const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const teamUserRoutes = require('./routes/team-users');
const profileRoutes = require('./routes/profiles');
const auditLogRoutes = require('./routes/audit-logs');
const { HttpError } = require('./validators');

function createApp() {
    const app = express();
    app.use(helmet());
    app.use(cors());
    app.use(express.json({ limit: '5mb' }));
    app.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

    app.get('/health', (req, res) => res.json({ ok: true }));
    app.use('/api/auth', authRoutes);
    app.use('/api/team-users', teamUserRoutes);
    app.use('/api/profiles', profileRoutes);
    app.use('/api/audit-logs', auditLogRoutes);

    app.use((req, res) => {
        res.status(404).json({ message: 'Не знайдено.' });
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err instanceof HttpError) {
            return res.status(err.status).json({ message: err.message });
        }
        console.error('[server] Unhandled error:', err);
        res.status(500).json({ message: 'Внутрішня помилка сервера.' });
    });

    return app;
}

module.exports = { createApp };
