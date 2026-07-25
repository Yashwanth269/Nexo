const redis = require('../config/redis');
const db = require('../config/db');
const { randomUUID } = require('crypto');

const LOCK_TTL = 30;
const BASE_RETRY_DELAY_MS = 100;
const MAX_RETRIES = 5;

class DistributedLock {
    constructor() {
        this.instanceId = `node-instance-${randomUUID()}`;
    }

    _getLockKey(lockName) {
        return `lock:nexo:${lockName}`;
    }

    /**
     * Acquire a Redis lock atomically. Returns a unique token to verify ownership later.
     */
    async acquire(lockName, ttlSeconds = LOCK_TTL) {
        const lockKey = this._getLockKey(lockName);
        const token = randomUUID();
        
        const acquired = await redis.set(lockKey, token, 'NX', 'EX', ttlSeconds);
        if (acquired === 'OK' || acquired === true) {
            return { success: true, lockKey, token, ttl: ttlSeconds };
        }
        return { success: false, lockKey };
    }

    /**
     * Acquires a lock retrying with exponential backoff and random jitter.
     */
    async acquireWithRetry(lockName, ttlSeconds = LOCK_TTL, maxRetries = MAX_RETRIES) {
        let delay = BASE_RETRY_DELAY_MS;
        
        for (let i = 0; i < maxRetries; i++) {
            const result = await this.acquire(lockName, ttlSeconds);
            if (result.success) return result;

            // Exponential backoff with jitter
            const jitter = Math.random() * 50; // Jitter up to 50ms
            const waitTime = delay * Math.pow(2, i) + jitter;
            await new Promise(r => setTimeout(r, waitTime));
        }
        return { success: false, lockName, reason: 'Max retries exceeded' };
    }

    /**
     * Releases a lock ONLY if the provided token matches, preventing cross-process release.
     */
    async release(lockName, token) {
        if (!token) return false;
        
        const lockKey = this._getLockKey(lockName);
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;

        try {
            const result = await redis.eval(script, 1, lockKey, token);
            return parseInt(result, 10) === 1;
        } catch (err) {
            console.error('[DISTRIBUTED-LOCK] Lua release failed:', err.message);
            // Fallback: Delete if matched manually
            const currentVal = await redis.get(lockKey);
            if (currentVal === token) {
                await redis.del(lockKey);
                return true;
            }
            return false;
        }
    }

    async isLocked(lockName) {
        const lockKey = this._getLockKey(lockName);
        const val = await redis.get(lockKey);
        return val !== null;
    }

    /**
     * Renews the lock lease if the token matches.
     */
    async extendLock(lockName, token, ttlSeconds = LOCK_TTL) {
        if (!token) return false;
        
        const lockKey = this._getLockKey(lockName);
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("expire", KEYS[1], ARGV[2])
            else
                return 0
            end
        `;
        
        try {
            const result = await redis.eval(script, 1, lockKey, token, ttlSeconds);
            return parseInt(result, 10) === 1;
        } catch (err) {
            console.error('[DISTRIBUTED-LOCK] Lua extend failed:', err.message);
            const currentVal = await redis.get(lockKey);
            if (currentVal === token) {
                await redis.expire(lockKey, ttlSeconds);
                return true;
            }
            return false;
        }
    }

    /**
     * Executes an async function block holding a lock, renewing the lease via heartbeat.
     */
    async executeWithLock(lockName, fn, ttlSeconds = LOCK_TTL) {
        const lock = await this.acquireWithRetry(lockName, ttlSeconds);
        if (!lock.success) {
            throw new Error(`Failed to acquire lock: ${lockName}`);
        }

        let heartbeatInterval;
        try {
            // Heartbeat renewal interval (1/3 of TTL seconds)
            const intervalMs = (ttlSeconds * 1000) / 3;
            heartbeatInterval = setInterval(async () => {
                try {
                    await this.extendLock(lockName, lock.token, ttlSeconds);
                } catch (err) {
                    console.warn(`[DISTRIBUTED-LOCK-HEARTBEAT-WARN] Lock renewal failed: ${lockName}`, err.message);
                }
            }, intervalMs);

            return await fn();
        } finally {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            await this.release(lockName, lock.token);
        }
    }

    /**
     * Advisory DB Lock fallback matching unique node instances.
     */
    async acquireDbLock(lockName, ttlSeconds = LOCK_TTL) {
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        try {
            // Atomic UPSERT advisory check using unique instanceId
            await db.query(
                `INSERT INTO distributed_locks (lock_name, lock_holder, expires_at) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (lock_name) 
                 DO UPDATE SET lock_holder = $2, expires_at = $3 
                 WHERE distributed_locks.expires_at < NOW()`,
                [lockName, this.instanceId, expiresAt]
            );
            const check = await db.query(
                'SELECT lock_holder FROM distributed_locks WHERE lock_name = $1 AND lock_holder = $2', 
                [lockName, this.instanceId]
            );
            return check.rowCount > 0;
        } catch (e) {
            console.error('[DB_LOCK] Failed:', e.message);
            return false;
        }
    }

    /**
     * Releases DB Lock only if held by this instance.
     */
    async releaseDbLock(lockName) {
        try {
            await db.query(
                'DELETE FROM distributed_locks WHERE lock_name = $1 AND lock_holder = $2', 
                [lockName, this.instanceId]
            );
        } catch (e) {
            console.error('[DB_LOCK] Release failed:', e.message);
        }
    }
}

module.exports = new DistributedLock();
