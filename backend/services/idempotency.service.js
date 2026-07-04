const db = require('../config/db');
const crypto = require('crypto');

class IdempotencyService {
    async processRequest(idempotencyKey, handler) {
        if (!idempotencyKey) {
            return handler();
        }

        const existing = await this.lookup(idempotencyKey);
        if (existing) {
            return existing;
        }

        const result = await handler();
        await this.record(idempotencyKey, result);
        return result;
    }

    async lookup(key) {
        try {
            const res = await db.query(
                'SELECT response_status, response_body FROM idempotency_keys WHERE idempotency_key = $1',
                [key]
            );
            if (res.rowCount > 0) {
                return {
                    status: res.rows[0].response_status,
                    body: res.rows[0].response_body,
                    fromCache: true
                };
            }
        } catch (e) {
            console.error('[IDEMPOTENCY] Lookup failed:', e.message);
        }
        return null;
    }

    async record(key, response, statusCode) {
        statusCode = statusCode || 200;
        try {
            await db.query(
                'INSERT INTO idempotency_keys (idempotency_key, response_status, response_body) VALUES ($1, $2, $3) ON CONFLICT (idempotency_key) DO NOTHING',
                [key, statusCode, JSON.stringify(response)]
            );
        } catch (e) {
            console.error('[IDEMPOTENCY] Record failed:', e.message);
        }
    }

    generateKey(parts) {
        const raw = Object.values(parts).join(':');
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    async cleanup(maxAgeHours) {
        maxAgeHours = maxAgeHours || 48;
        try {
            const res = await db.query(
                'DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL \'' + maxAgeHours + ' hours\''
            );
            console.log('[IDEMPOTENCY] Cleaned up ' + (res.rowCount || 0) + ' old keys');
        } catch (e) {
            console.error('[IDEMPOTENCY] Cleanup failed:', e.message);
        }
    }
}

module.exports = new IdempotencyService();
