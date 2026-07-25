const db = require('../config/db');
const redis = require('../config/redis');
const crypto = require('crypto');

class IdempotencyService {
    /**
     * Executes the handler atomically while guarding against duplicate concurrency race conditions
     */
    async processRequest(idempotencyKey, handler, reqBody = null) {
        if (!idempotencyKey) {
            return handler();
        }

        const bodyHash = reqBody ? crypto.createHash('sha256').update(JSON.stringify(reqBody)).digest('hex') : null;

        // 1. Check existing record
        const existing = await this.lookup(idempotencyKey);
        if (existing) {
            // Verify payload integrity matches fingerprint hash
            if (bodyHash && existing.requestHash && existing.requestHash !== bodyHash) {
                throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
            }
            if (existing.status === 'PROCESSING') {
                // Wait for concurrent request to finish (polling database state)
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    const updated = await this.lookup(idempotencyKey);
                    if (updated && updated.status !== 'PROCESSING') {
                        return updated;
                    }
                }
                throw new Error("CONCURRENT_REQUEST_TIMED_OUT");
            }
            return existing;
        }

        // 2. Atomic Lock & Transition status to PROCESSING (uses transactions and ON CONFLICT DO NOTHING)
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            
            const insertRes = await client.query(
                `INSERT INTO idempotency_keys (idempotency_key, response_status, status, request_hash)
                 VALUES ($1, 202, 'PROCESSING', $2)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING status`,
                [idempotencyKey, bodyHash]
            );

            if (insertRes.rowCount === 0) {
                // Another thread registered this key concurrently
                await client.query('ROLLBACK');
                client.release();
                
                // Wait for the duplicate processing to finish
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    const updated = await this.lookup(idempotencyKey);
                    if (updated && updated.status !== 'PROCESSING') {
                        return updated;
                    }
                }
                throw new Error("CONCURRENT_REQUEST_TIMED_OUT");
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            client.release();
            throw e;
        }

        // 3. Execute Handler
        try {
            const result = await handler();
            
            // Mark COMPLETED with serialized payload
            await db.query(
                `UPDATE idempotency_keys 
                 SET response_status = $1, response_body = $2, status = 'COMPLETED', updated_at = NOW()
                 WHERE idempotency_key = $3`,
                [200, JSON.stringify(result), idempotencyKey]
            );
            return result;
        } catch (handlerErr) {
            // Mark FAILED
            await db.query(
                `UPDATE idempotency_keys 
                 SET response_status = 500, status = 'FAILED', updated_at = NOW()
                 WHERE idempotency_key = $1`,
                [idempotencyKey]
            );
            throw handlerErr;
        } finally {
            client.release();
        }
    }

    async lookup(key) {
        try {
            const res = await db.query(
                'SELECT response_status, response_body, status, request_hash FROM idempotency_keys WHERE idempotency_key = $1',
                [key]
            );
            if (res.rowCount > 0) {
                return {
                    status: res.rows[0].status,
                    responseStatus: res.rows[0].response_status,
                    body: res.rows[0].response_body ? JSON.parse(res.rows[0].response_body) : null,
                    requestHash: res.rows[0].request_hash,
                    fromCache: true
                };
            }
        } catch (e) {
            console.error('[IDEMPOTENCY] Lookup failed:', e.message);
        }
        return null;
    }

    async record(key, response, statusCode = 200) {
        try {
            await db.query(
                `INSERT INTO idempotency_keys (idempotency_key, response_status, response_body, status) 
                 VALUES ($1, $2, $3, 'COMPLETED') 
                 ON CONFLICT (idempotency_key) 
                 DO UPDATE SET response_status = EXCLUDED.response_status, response_body = EXCLUDED.response_body, status = 'COMPLETED', updated_at = NOW()`,
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

    /**
     * Cleans up expired idempotency keys (uses parameterized intervals to prevent SQL Injection risks)
     */
    async cleanup(maxAgeHours = 48) {
        try {
            const limitTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
            const res = await db.query(
                'DELETE FROM idempotency_keys WHERE created_at < $1',
                [limitTime]
            );
            console.log(`[IDEMPOTENCY] Cleaned up ${res.rowCount || 0} old keys`);
        } catch (e) {
            console.error('[IDEMPOTENCY] Cleanup failed:', e.message);
        }
    }
}

module.exports = new IdempotencyService();
