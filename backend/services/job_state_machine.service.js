const db = require('../config/db');
const redis = require('../config/redis');

const STATES = {
    CREATED: 'CREATED',
    SEARCHING: 'SEARCHING',
    OFFER_SENT: 'OFFER_SENT',
    ACCEPTED: 'ACCEPTED',
    ON_THE_WAY: 'ON_THE_WAY',
    ARRIVED: 'ARRIVED',
    WORK_STARTED: 'WORK_STARTED',
    WORK_COMPLETED: 'WORK_COMPLETED',
    PAYMENT_PENDING: 'PAYMENT_PENDING',
    SETTLED: 'SETTLED',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
    DISPUTED: 'DISPUTED',
};

const TRANSITIONS = {
    [STATES.CREATED]: [STATES.SEARCHING, STATES.CANCELLED, STATES.EXPIRED],
    [STATES.SEARCHING]: [STATES.OFFER_SENT, STATES.CANCELLED, STATES.EXPIRED],
    [STATES.OFFER_SENT]: [STATES.ACCEPTED, STATES.CANCELLED, STATES.EXPIRED],
    [STATES.ACCEPTED]: [STATES.ON_THE_WAY, STATES.CANCELLED],
    [STATES.ON_THE_WAY]: [STATES.ARRIVED, STATES.CANCELLED],
    [STATES.ARRIVED]: [STATES.WORK_STARTED, STATES.CANCELLED],
    [STATES.WORK_STARTED]: [STATES.WORK_COMPLETED, STATES.CANCELLED],
    [STATES.WORK_COMPLETED]: [STATES.PAYMENT_PENDING, STATES.DISPUTED],
    [STATES.PAYMENT_PENDING]: [STATES.SETTLED, STATES.DISPUTED],
    [STATES.SETTLED]: [],
    [STATES.CANCELLED]: [],
    [STATES.EXPIRED]: [],
    [STATES.DISPUTED]: [STATES.PAYMENT_PENDING, STATES.SETTLED],
};

const TIMESTAMPS = {
    [STATES.ACCEPTED]: 'accepted_at',
    [STATES.ON_THE_WAY]: 'on_the_way_at',
    [STATES.ARRIVED]: 'arrived_at',
    [STATES.WORK_STARTED]: 'started_at',
    [STATES.WORK_COMPLETED]: 'completed_at',
    [STATES.PAYMENT_PENDING]: 'payment_pending_at',
    [STATES.SETTLED]: 'settled_at',
    [STATES.CANCELLED]: 'cancelled_at',
};

class JobStateMachine {
    get STATES() { return STATES; }

    isValidTransition(fromState, toState) {
        const allowed = TRANSITIONS[fromState];
        if (!allowed) return false;
        return allowed.includes(toState);
    }

    async transition(jobId, toState, options) {
        if (!options) options = {};
        const { userId, workerId, reason, metadata } = options;

        const currentRes = await db.query('SELECT status, worker_id FROM jobs WHERE id = ', [jobId]);
        if (currentRes.rowCount === 0) {
            throw new Error('Job not found: ' + jobId);
        }

        const currentState = currentRes.rows[0].status;
        if (!this.isValidTransition(currentState, toState)) {
            throw new Error('Illegal state transition: ' + currentState + ' -> ' + toState);
        }

        const timestampField = TIMESTAMPS[toState];
        const tsClause = timestampField ? (', ' + timestampField + ' = CURRENT_TIMESTAMP') : '';

        let setClauses = ['status = ' + tsClause + ', updated_at = CURRENT_TIMESTAMP'];
        let params = [jobId, toState];
        let paramIdx = 3;

        if (reason) {
            setClauses.push('cancellation_reason = $' + paramIdx);
            params.push(reason);
            paramIdx++;
        }

        if (toState === STATES.CANCELLED) {
            setClauses.push('cancelled_by = $' + paramIdx);
            params.push(userId ? 'USER' : 'SYSTEM');
            paramIdx++;
        }

        await db.query('UPDATE jobs SET ' + setClauses.join(', ') + ' WHERE id = ', params);

        await this._logTransition(jobId, currentState, toState, metadata);

        if ([STATES.CANCELLED, STATES.EXPIRED, STATES.SETTLED].includes(toState)) {
            await this._cleanupRedis(jobId);
        }

        return { jobId, from: currentState, to: toState, success: true };
    }

    async _logTransition(jobId, fromState, toState, metadata) {
        try {
            await db.query('INSERT INTO job_history (job_id, status, metadata) VALUES (, , )', [jobId, toState, JSON.stringify({ from: fromState, to: toState, metadata: metadata || {} })]);
        } catch (e) {
            console.error('[STATE_MACHINE] Failed to log transition:', e.message);
        }
    }

    async _cleanupRedis(jobId) {
        try {
            const geohash = await redis.get('job:' + jobId + ':geohash');
            if (geohash) {
                await redis.zrem('jobs:geo:' + geohash, jobId);
            }
            await redis.del('job:' + jobId + ':geohash', 'job:' + jobId + ':status');
            await redis.srem('jobs:active_set', jobId);
        } catch (e) {
            console.error('[STATE_MACHINE] Redis cleanup failed:', e.message);
        }
    }

    getValidTransitions(state) {
        return TRANSITIONS[state] || [];
    }

    isTerminalState(state) {
        return [STATES.SETTLED, STATES.CANCELLED, STATES.EXPIRED].includes(state);
    }

    canBeDispatched(state) {
        return [STATES.CREATED, STATES.SEARCHING].includes(state);
    }

    isActiveJob(state) {
        return [STATES.ACCEPTED, STATES.ON_THE_WAY, STATES.ARRIVED, STATES.WORK_STARTED].includes(state);
    }
}

module.exports = new JobStateMachine();