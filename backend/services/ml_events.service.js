const db = require('../config/db');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
if (!fsSync.existsSync(logDir)) fsSync.mkdirSync(logDir, { recursive: true });

// Strict Event Schemas for Data Lake Integrity (Point 2)
const EVENT_SCHEMAS = {
    DispatchAccepted: {
        required: ['jobId', 'workerId', 'distanceKm', 'acceptanceLatencySeconds'],
        types: { jobId: 'string', workerId: 'string', distanceKm: 'number', acceptanceLatencySeconds: 'number' }
    },
    DisputeCreated: {
        required: ['jobId', 'disputeReason', 'severity'],
        types: { jobId: 'string', disputeReason: 'string', severity: 'string' }
    },
    JobCompleted: {
        required: ['jobId', 'workerId', 'completionCode', 'durationMins'],
        types: { jobId: 'string', workerId: 'string', completionCode: 'string', durationMins: 'number' }
    }
};

function validateEventPayload(eventType, metadata) {
    const schema = EVENT_SCHEMAS[eventType];
    if (!schema) return true; // generic fallback if schema is not defined

    for (const key of schema.required) {
        if (metadata[key] === undefined || metadata[key] === null) {
            throw new Error(`Missing required field: ${key} for event ${eventType}`);
        }
        if (typeof metadata[key] !== schema.types[key]) {
            throw new Error(`Invalid type for field ${key} for event ${eventType}. Expected ${schema.types[key]}, got ${typeof metadata[key]}`);
        }
    }
    return true;
}

/**
 * ML Event Logger - Captures all user/worker actions for training data
 */
const logEvent = async (userId, eventType, metadata = {}) => {
    const timestamp = new Date().toISOString();
    
    // Validate schema before committing to database or log files
    try {
        validateEventPayload(eventType, metadata);
    } catch (validationErr) {
        console.warn(`[ML-EVENT-SCHEMA-WARN] Validation failed for ${eventType}:`, validationErr.message);
        return; // reject invalid events to preserve lake cleanliness
    }

    const event = { userId, eventType, metadata, timestamp };

    // 1. Primary Store: PostgreSQL (Structured)
    try {
        await db.query(
            'INSERT INTO event_logs (user_id, event_type, metadata, timestamp) VALUES ($1, $2, $3, $4)',
            [userId, eventType, JSON.stringify(metadata), timestamp]
        );
    } catch (err) {
        console.warn('DB Event Logging failed, using file fallback', err.message);
    }

    // 2. Data Lake: Partitioned Async Logs by Day and Event Type (Points 1 & 3)
    const dateStr = new Date().toISOString().split('T')[0];
    const partitionDir = path.join(logDir, dateStr);
    
    try {
        // Asynchronous directory initialization
        await fs.mkdir(partitionDir, { recursive: true });
        const logFile = path.join(partitionDir, `${eventType}.json`);
        
        // Asynchronous non-blocking file append
        await fs.appendFile(logFile, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
        console.error('[ML-EVENT-FILE-ERROR] Failed to write event to data lake:', err.message);
    }
};

module.exports = { logEvent };
