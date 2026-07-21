const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');

const STATES = {
    BOOKED: 'BOOKED',
    VALIDATED: 'VALIDATED',
    QUEUED: 'QUEUED',
    DISPATCHING: 'DISPATCHING',
    WORKER_ASSIGNED: 'WORKER_ASSIGNED',
    WORKER_CONFIRMED: 'WORKER_CONFIRMED',
    WORKER_EN_ROUTE: 'WORKER_EN_ROUTE',
    WORKER_ARRIVED: 'WORKER_ARRIVED',
    OTP_VERIFIED: 'OTP_VERIFIED',
    SERVICE_STARTED: 'SERVICE_STARTED',
    SERVICE_IN_PROGRESS: 'SERVICE_IN_PROGRESS',
    SERVICE_PAUSED: 'SERVICE_PAUSED',
    SERVICE_RESUMED: 'SERVICE_RESUMED',
    SERVICE_COMPLETED: 'SERVICE_COMPLETED',
    CUSTOMER_VERIFIED: 'CUSTOMER_VERIFIED',
    PAYMENT_CAPTURED: 'PAYMENT_CAPTURED',
    WORKER_PAYOUT_PENDING: 'WORKER_PAYOUT_PENDING',
    WORKER_PAYOUT_COMPLETED: 'WORKER_PAYOUT_COMPLETED',
    JOB_CLOSED: 'JOB_CLOSED',
    
    // Terminal States & Exits
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
    DISPUTED: 'DISPUTED'
};

// Map legacy states to standard lifecycle states for backward compatibility
const LEGACY_MAP = {
    'OPEN': STATES.DISPATCHING,
    'BUILD_QUEUE': STATES.QUEUED,
    'POOL_1_ACTIVE': STATES.DISPATCHING,
    'POOL_2_ACTIVE': STATES.DISPATCHING,
    'POOL_3_ACTIVE': STATES.DISPATCHING,
    'REDISTRIBUTING': STATES.DISPATCHING,
    'REASSIGNING': STATES.DISPATCHING,
    'ACCEPTED': STATES.WORKER_ASSIGNED,
    'RESERVED': STATES.WORKER_ASSIGNED,
    'ON_THE_WAY': STATES.WORKER_EN_ROUTE,
    'ARRIVED': STATES.WORKER_ARRIVED,
    'WORK_IN_PROGRESS': STATES.SERVICE_IN_PROGRESS,
    'WORK_STARTED': STATES.SERVICE_STARTED,
    'STARTED': STATES.SERVICE_STARTED,
    'COMPLETED': STATES.SERVICE_COMPLETED,
    'SETTLED': STATES.JOB_CLOSED
};

const TRANSITIONS = {
    [STATES.BOOKED]: [STATES.VALIDATED, STATES.CANCELLED],
    [STATES.VALIDATED]: [STATES.QUEUED, STATES.CANCELLED],
    [STATES.QUEUED]: [STATES.DISPATCHING, STATES.CANCELLED],
    [STATES.DISPATCHING]: [STATES.WORKER_ASSIGNED, STATES.CANCELLED, STATES.EXPIRED],
    [STATES.WORKER_ASSIGNED]: [STATES.WORKER_CONFIRMED, STATES.WORKER_EN_ROUTE, STATES.CANCELLED],
    [STATES.WORKER_CONFIRMED]: [STATES.WORKER_EN_ROUTE, STATES.CANCELLED],
    [STATES.WORKER_EN_ROUTE]: [STATES.WORKER_ARRIVED, STATES.CANCELLED],
    [STATES.WORKER_ARRIVED]: [STATES.OTP_VERIFIED, STATES.CANCELLED],
    [STATES.OTP_VERIFIED]: [STATES.SERVICE_STARTED],
    [STATES.SERVICE_STARTED]: [STATES.SERVICE_IN_PROGRESS],
    [STATES.SERVICE_IN_PROGRESS]: [STATES.SERVICE_PAUSED, STATES.SERVICE_COMPLETED, STATES.CANCELLED],
    [STATES.SERVICE_PAUSED]: [STATES.SERVICE_RESUMED],
    [STATES.SERVICE_RESUMED]: [STATES.SERVICE_IN_PROGRESS, STATES.SERVICE_COMPLETED],
    [STATES.SERVICE_COMPLETED]: [STATES.CUSTOMER_VERIFIED, STATES.DISPUTED],
    [STATES.CUSTOMER_VERIFIED]: [STATES.PAYMENT_CAPTURED, STATES.DISPUTED],
    [STATES.PAYMENT_CAPTURED]: [STATES.WORKER_PAYOUT_PENDING, STATES.DISPUTED],
    [STATES.WORKER_PAYOUT_PENDING]: [STATES.WORKER_PAYOUT_COMPLETED],
    [STATES.WORKER_PAYOUT_COMPLETED]: [STATES.JOB_CLOSED],
    [STATES.JOB_CLOSED]: [],
    
    // Recovery / resolution transitions
    [STATES.DISPUTED]: [STATES.PAYMENT_CAPTURED, STATES.WORKER_PAYOUT_PENDING, STATES.JOB_CLOSED],
    [STATES.CANCELLED]: [],
    [STATES.EXPIRED]: []
};

// Map states to legacy columns in postgres if they exist
const TIMESTAMPS = {
    [STATES.WORKER_ASSIGNED]: 'accepted_at',
    [STATES.WORKER_EN_ROUTE]: 'on_the_way_at',
    [STATES.WORKER_ARRIVED]: 'arrived_at',
    [STATES.SERVICE_STARTED]: 'started_at',
    [STATES.SERVICE_COMPLETED]: 'completed_at',
    [STATES.CANCELLED]: 'cancelled_at'
};

class JobStateMachine {
    get STATES() { return STATES; }

    resolveState(state) {
        if (!state) return STATES.BOOKED;
        const norm = state.toUpperCase();
        return LEGACY_MAP[norm] || norm;
    }

    isValidTransition(fromState, toState) {
        const resolvedFrom = this.resolveState(fromState);
        const resolvedTo = this.resolveState(toState);
        
        if (resolvedFrom === resolvedTo) return true; // Self-transition is a no-op

        const allowed = TRANSITIONS[resolvedFrom];
        if (!allowed) return false;
        return allowed.includes(resolvedTo);
    }

    async transition(jobId, toState, options = {}) {
        const { userId, workerId, reason, metadata, client: txClient } = options;
        const resolvedTo = this.resolveState(toState);
        const executor = txClient || db;

        const currentRes = await executor.query('SELECT status, worker_id, user_id, state_timestamps FROM jobs WHERE id = $1::uuid', [jobId]);
        if (currentRes.rowCount === 0) {
            throw new Error('Job not found: ' + jobId);
        }

        const currentRawState = currentRes.rows[0].status;
        const resolvedFrom = this.resolveState(currentRawState);

        if (!this.isValidTransition(resolvedFrom, resolvedTo)) {
            throw new Error(`Illegal state transition: ${currentRawState} (${resolvedFrom}) -> ${toState} (${resolvedTo})`);
        }

        // Prepare updated state_timestamps JSONB
        const existingTimestamps = currentRes.rows[0].state_timestamps || {};
        existingTimestamps[resolvedTo] = new Date().toISOString();

        const timestampField = TIMESTAMPS[resolvedTo];
        const tsClause = timestampField ? `, ${timestampField} = CURRENT_TIMESTAMP` : '';

        let setClauses = [
            'status = $2',
            'state_timestamps = $3',
            'updated_at = CURRENT_TIMESTAMP' + tsClause
        ];
        let params = [jobId, resolvedTo, JSON.stringify(existingTimestamps)];
        let paramIdx = 4;

        if (reason) {
            setClauses.push(`cancellation_reason = $${paramIdx}`);
            params.push(reason);
            paramIdx++;
        }

        if (resolvedTo === STATES.CANCELLED) {
            setClauses.push(`cancelled_by = $${paramIdx}`);
            params.push(userId ? 'USER' : (workerId ? 'WORKER' : 'SYSTEM'));
            paramIdx++;
        }

        await executor.query(`UPDATE jobs SET ${setClauses.join(', ')} WHERE id = $1::uuid`, params);

        // Save history audit trail
        await this._logTransition(jobId, currentRawState, resolvedTo, metadata, workerId || currentRes.rows[0].worker_id, txClient);

        // Redis syncing & cleanup
        await redis.set(`job:${jobId}:status`, resolvedTo, 'EX', 3600);
        if ([STATES.CANCELLED, STATES.EXPIRED, STATES.JOB_CLOSED].includes(resolvedTo)) {
            await this._cleanupRedis(jobId);
        }

        // Emit Events to clients
        const io = getIO();
        if (io) {
            const channelId = currentRes.rows[0].user_id;
            const payload = { jobId, from: resolvedFrom, to: resolvedTo, metadata: metadata || {} };
            
            io.to(`user:${channelId}`).emit('job_status_updated', payload);
            io.to(`job:${jobId}`).emit('job_status_updated', payload);

            const resolvedWorker = workerId || currentRes.rows[0].worker_id;
            if (resolvedWorker) {
                io.to(`worker:${resolvedWorker}`).emit('active_job_updated', payload);
            }
        }

        return { jobId, from: resolvedFrom, to: resolvedTo, success: true };
    }

    async _logTransition(jobId, fromState, toState, metadata, workerId = null, txClient = null) {
        try {
            const executor = txClient || db;
            await executor.query(
                `INSERT INTO job_history (job_id, worker_id, status, metadata) 
                 VALUES ($1, $2, $3, $4)`, 
                [jobId, workerId, toState, JSON.stringify({ from: fromState, to: toState, metadata: metadata || {} })]
            );
        } catch (e) {
            console.error('[STATE_MACHINE] Failed to log transition:', e.message);
        }
    }

    async _cleanupRedis(jobId) {
        try {
            const geohash = await redis.get(`job:${jobId}:geohash`);
            if (geohash) {
                await redis.zrem(`jobs:geo:${geohash}`, jobId);
            }
            await redis.del(`job:${jobId}:geohash`, `job:${jobId}:status`, `job:${jobId}:searching`);
            await redis.srem('jobs:active_set', jobId);
        } catch (e) {
            console.error('[STATE_MACHINE] Redis cleanup failed:', e.message);
        }
    }

    getValidTransitions(state) {
        return TRANSITIONS[this.resolveState(state)] || [];
    }

    isTerminalState(state) {
        const resolved = this.resolveState(state);
        return [STATES.JOB_CLOSED, STATES.CANCELLED, STATES.EXPIRED].includes(resolved);
    }

    isActiveJob(state) {
        const resolved = this.resolveState(state);
        return [
            STATES.WORKER_ASSIGNED, 
            STATES.WORKER_CONFIRMED, 
            STATES.WORKER_EN_ROUTE, 
            STATES.WORKER_ARRIVED, 
            STATES.OTP_VERIFIED,
            STATES.SERVICE_STARTED, 
            STATES.SERVICE_IN_PROGRESS,
            STATES.SERVICE_PAUSED,
            STATES.SERVICE_RESUMED
        ].includes(resolved);
    }
}

module.exports = new JobStateMachine();