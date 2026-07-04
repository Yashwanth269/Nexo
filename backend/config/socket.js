// =============================================================
// SOCKET.IO SINGLETON — Breaks circular dependency chain
// index.js → services → index.js was causing partial exports.
// Now all services/routes import { getIO } from '../config/socket'
// =============================================================

let _io = null;

/**
 * Store the Socket.IO server instance.
 * Called once from index.js after creation.
 */
function setIO(io) {
    _io = io;
}

/**
 * Retrieve the Socket.IO server instance.
 * Throws if called before initialization.
 */
function getIO() {
    if (!_io) {
        throw new Error('[FATAL] Socket.IO not initialized. Ensure setIO() is called in index.js before any service initialization.');
    }
    return _io;
}

module.exports = { setIO, getIO };
