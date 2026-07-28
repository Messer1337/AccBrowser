const http = require('http');
const { createApp } = require('./app');
const { attachSockets } = require('./sockets');

const port = Number(process.env.PORT || 3000);
const app = createApp();
const httpServer = http.createServer(app);
attachSockets(httpServer);

httpServer.listen(port, () => {
    console.log(`[server] OASIS self-hosted backend listening on :${port}`);
});
