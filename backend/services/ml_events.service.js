const db = require('../config/db');
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

/**
 * ML Event Logger - Captures all user/worker actions for training data
 */
const logEvent = async (userId, eventType, metadata = {}) => {
    const timestamp = new Date().toISOString();
    const event = { userId, eventType, metadata, timestamp };

    // 1. Primary Store: PostgreSQL (Structured)
    try {
        await db.query(
            'INSERT INTO event_logs (user_id, event_type, metadata, timestamp) VALUES ($1, $2, $3, $4)',
            [userId, eventType, JSON.stringify(metadata), timestamp]
        );
    } catch (err) {
        // Fallback or just log to console if DB is not ready during dev
        console.warn('DB Event Logging failed, using file fallback', err.message);
    }

    // 2. Data Lake Fallback: Local JSON (ML Pipeline Source)
    const logFile = path.join(logDir, `events_${new Date().toISOString().split('T')[0]}.json`);
    try {
        fs.appendFileSync(logFile, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
        console.error('File logging failed', err);
    }
};

module.exports = { logEvent };
