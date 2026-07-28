const { EventEmitter } = require('events');

// Decouples routes (which mutate rows) from sockets/index.js (which broadcasts them),
// so routes never import the Socket.IO server directly.
const backendEvents = new EventEmitter();
backendEvents.setMaxListeners(50);

module.exports = backendEvents;
