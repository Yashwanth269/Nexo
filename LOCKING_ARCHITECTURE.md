# Distributed Locking Architecture

## Overview

Prepare for multi-server deployment with Redis-based distributed locking. Prevents double-acceptance, double-payout, duplicate worker assignment, and other race conditions.

## Lock Types

| Lock Name | TTL | Purpose |
|-----------|-----|---------|
| `lock:accept:JOB_ID:WORKER_ID` | 30s | Prevent double job acceptance |
| `lock:offer:JOB_ID:WORKER_ID` | 120s | Prevent duplicate offer creation |
| `lock:redispatch:JOB_ID` | 60-180s | Prevent concurrent redispatches |
| `lock:dispatch:JOB_ID` | 30s | Prevent duplicate dispatch |
| `lock:payout:PAYOUT_ID` | 30s | Prevent duplicate payout processing |
| `lock:escrow:JOB_ID` | 30s | Prevent double escrow release |
| `lock:dispute:JOB_ID` | 30s | Prevent concurrent dispute resolution |
| `lock:backup:JOB_ID` | 30s | Prevent double backup activation |
| `lock:wallet:USER_ID` | 10s | Prevent concurrent wallet operations |

## Implementation

### distributed_lock.service.js

```javascript
class DistributedLock {
    async acquire(lockName, ttlSeconds)       // Redis SET NX EX
    async acquireWithRetry(lockName, ttl, retries) // Retry with backoff
    async release(lockName)                    // Redis DEL
    async isLocked(lockName)                   // Redis GET check
    async extendLock(lockName, ttlSeconds)     // Redis EXPIRE
    async executeWithLock(lockName, fn, ttl)   // Acquire -> execute -> release
    async acquireDbLock(lockName, ttlSeconds)  // PG fallback (distributed_locks table)
    async releaseDbLock(lockName)              // PG DELETE
}
```

## Redis vs Database Fallback

| Feature | Redis Lock | Database Lock |
|---------|-----------|---------------|
| Speed | ~1ms | ~10ms |
| TTL auto-expire | Yes (EX) | Yes (expires_at) |
| Deadlock safe | Yes | Yes (stale check) |
| Multi-server | Yes | Yes |
| Dependency | Redis required | PG only |

## Deadlock Prevention

1. All locks have TTL (no permanent locks)
2. `executeWithLock()` always releases in `finally` block
3. DB locks check `expires_at < NOW()` before acquiring
4. Auto-recovery probe reaps stale locks every 5s

## Prometheus Metrics (TODO)

| Metric | Type | Labels |
|--------|------|--------|
| lock_acquire_total | Counter | lock_name, result |
| lock_acquire_duration_ms | Histogram | lock_name |
| lock_contention_total | Counter | lock_name |

## Integration Points

| Service | Locks Used |
|---------|------------|
| matching.service.js | offer_lock, redispatch_lock |
| execution.service.js | accept_lock, dispatch_lock |
| payment.service.js | payout_lock, escrow_lock, wallet_lock |
| dispute.service.js | dispute_lock |
| backup_worker.service.js | backup_lock |
