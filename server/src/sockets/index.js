const { Server } = require('socket.io');
const { verify } = require('../auth/jwt');
const { pool } = require('../db');
const { hasProfileAccess } = require('../auth/middleware');
const backendEvents = require('../events');

function attachSockets(httpServer) {
    const io = new Server(httpServer, { cors: { origin: '*' } });

    io.use(async (socket, next) => {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        const username = token ? verify(token) : null;
        if (!username) return next(new Error('unauthenticated'));
        const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
        if (!rows.length) return next(new Error('unauthenticated'));
        socket.user = rows[0];
        next();
    });

    io.on('connection', (socket) => {
        // Own-record room: how a revoked/edited user is notified in real time, replacing
        // AuthManager's onSnapshot(teamUsers/{username}) listener.
        socket.join(`team-user:${socket.user.username}`);

        socket.on('subscribe:profile', ({ profileId }) => {
            if (typeof profileId === 'string' && hasProfileAccess(socket.user, profileId)) {
                socket.join(`profile:${profileId}`);
            }
        });

        socket.on('subscribe:profiles', () => {
            if (socket.user.role === 'admin') socket.join('profiles');
        });
    });

    backendEvents.on('profile-updated', ({ profileId, data }) => {
        io.to(`profile:${profileId}`).emit('profile-updated', { profileId, data });
    });
    backendEvents.on('profiles-changed', (changes) => {
        io.to('profiles').emit('profiles-changed', changes);
    });
    backendEvents.on('team-user-updated', ({ username, data }) => {
        io.to(`team-user:${username}`).emit('team-user-updated', { username, data });
    });
    backendEvents.on('team-user-revoked', ({ username }) => {
        io.to(`team-user:${username}`).emit('team-user-revoked', { username });
    });

    return io;
}

module.exports = { attachSockets };
