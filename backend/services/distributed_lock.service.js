const redis = require('../config/redis');
const db = require('../config/db');

const LOCK_TTL = 30;
const RETRY_DELAY_MS = 100;
const MAX_RETRIES = 5;

class DistributedLock {
    async acquire(lockName, ttlSeconds) {
        ttlSeconds = ttlSeconds || LOCK_TTL;
        const lockKey = 'lock:' + lockName;
        const acquired = await redis.set(lockKey, Date.now().toString(), 'NX', 'EX', ttlSeconds);
        if (acquired === 'OK' || acquired === true) {
            return { success: true, lockKey, ttl: ttlSeconds };
        }
        return { success: false, lockKey };
    }

    async acquireWithRetry(lockName, ttlSeconds, maxRetries) {
        maxRetries = maxRetries || MAX_RETRIES;
        for (let i = 0; i < maxRetries; i++) {
            const result = await this.acquire(lockName, ttlSeconds);
            if (result.success) return result;
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
        }
        return { success: false, lockName, reason: 'Max retries exceeded' };
    }

    async release(lockName) {
        await redis.del('lock:' + lockName);
    }

    async isLocked(lockName) {
        const val = await redis.get('lock:' + lockName);
        return val !== null;
    }

    async extendLock(lockName, ttlSeconds) {
        const lockKey = 'lock:' + lockName;
        const exists = await redis.get(lockKey);
        if (exists) {
            await redis.expire(lockKey, ttlSeconds);
            return true;
        }
        return false;
    }

    async executeWithLock(lockName, fn, ttlSeconds) {
        const lock = await this.acquireWithRetry(lockName, ttlSeconds);
        if (!lock.success) {
            throw new Error('Failed to acquire lock: ' + lockName);
        }
        try {
            return await fn();
        } finally {
            await this.release(lockName);
        }
    }

    async acquireDbLock(lockName, ttlSeconds) {
        ttlSeconds = ttlSeconds || LOCK_TTL;
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        try {
            await db.query(
                'INSERT INTO distributed_locks (lock_name, lock_holder, expires_at) VALUES ($1, $2, $3) ON CONFLICT (lock_name) DO UPDATE SET expires_at = $3 WHERE distributed_locks.expires_at < NOW()',
                [lockName, 'backend-' + process.pid, expiresAt]
            );
            const check = await db.query('SELECT lock_holder FROM distributed_locks WHERE lock_name = $1 AND lock_holder = $2', [lockName, 'backend-' + process.pid]);
            return check.rowCount > 0;
        } catch (e) {
            console.error('[DB_LOCK] Failed:', e.message);
            return false;
        }
    }

    async releaseDbLock(lockName) {
        try {
            await db.query('DELETE FROM distributed_locks WHERE lock_name = $1', [lockName]);
        } catch (e) {
            console.error('[DB_LOCK] Release failed:', e.message);
        }
    }
}

module.exports = new DistributedLock();
