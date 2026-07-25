const db = require('../config/db');
const redis = require('../config/redis');
const eventStream = require('../utils/event_stream');

const FEEDBACK_EVENTS = {
    CLICK: 'click',
    VIEW: 'view',
    ACCEPT: 'accept',
    COMPLETE: 'complete',
    RATE: 'rate',
    REJECT: 'reject',
    TIMEOUT: 'timeout',
    CANCEL: 'cancel',
};

class FeedbackService {
    /**
     * Record a ranking or feedback interaction.
     * Enforces idempotency via eventId and runs asynchronously.
     */
    async recordEvent(userId, workerId, jobId, actionType, metadata = {}) {
        const eventId = metadata.eventId || `${jobId}:${actionType}:${Date.now()}`;
        const idempotencyKey = `feedback:event:${eventId}`;

        // 1. Idempotency Check
        const isDuplicate = await redis.get(idempotencyKey);
        if (isDuplicate) {
            console.log(`[FEEDBACK-IDEMPOTENCY] Suppressed duplicate feedback event: ${eventId}`);
            return { success: true, duplicated: true };
        }

        // Apply idempotency TTL (24 hours)
        await redis.set(idempotencyKey, '1', 'EX', 86400);

        // 2. Click Spam / Abuse Protection Check
        const limitKey = `feedback:abuse:${userId || 'anon'}:${workerId}:${actionType}`;
        const clickCount = await redis.incr(limitKey);
        await redis.expire(limitKey, 60); // 1-minute window
        if (clickCount > 10) {
            console.warn(`[FEEDBACK-ABUSE-PREVENTION] Suppressed click spam from user ${userId} on worker ${workerId}`);
            return { success: false, reason: "RATE_LIMITED_ABUSE" };
        }

        // Persist the interaction record
        await db.query(
            `INSERT INTO ranking_clicks (user_id, worker_id, job_id, action_type, action_value, session_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                userId, workerId, jobId, actionType,
                metadata.value || 0, metadata.sessionId || null,
                JSON.stringify(metadata)
            ]
        );

        // Redis cache counters increment
        const pipeline = redis.pipeline();
        pipeline.incr(`feedback:${actionType}:count`);
        pipeline.incr(`feedback:worker:${workerId}:${actionType}:count`);
        pipeline.expire(`feedback:${actionType}:count`, 86400);
        await pipeline.exec();

        // 3. Asynchronous execution (Publish to event stream instead of sequential blocking updates)
        eventStream.publish('feedback_received', {
            userId,
            workerId,
            jobId,
            actionType,
            metadata
        }).catch(err => {
            console.error("[FEEDBACK-EVENT-WARN] Stream publish failed:", err.message);
        });

        // Trigger processing in background
        this.processFeedbackAction(userId, workerId, jobId, actionType, metadata).catch(err => {
            console.error("[FEEDBACK-PROCESSING-WARN] Background action failed:", err.message);
        });

        return { success: true };
    }

    async processFeedbackAction(userId, workerId, jobId, actionType, metadata) {
        switch (actionType) {
            case FEEDBACK_EVENTS.ACCEPT:
                await this.onAccept(userId, workerId, jobId, metadata);
                break;
            case FEEDBACK_EVENTS.COMPLETE:
                await this.onComplete(userId, workerId, jobId, metadata);
                break;
            case FEEDBACK_EVENTS.REJECT:
                await this.onReject(userId, workerId, jobId, metadata);
                break;
            case FEEDBACK_EVENTS.CANCEL:
                await this.onCancel(userId, workerId, jobId, metadata);
                break;
            case FEEDBACK_EVENTS.RATE:
                await this.onRate(userId, workerId, jobId, metadata);
                break;
        }
    }

    async onAccept(userId, workerId, jobId, metadata) {
        await db.query(
            `UPDATE worker_features SET
                avg_response_time = (
                    SELECT COALESCE(
                        (SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - j.created_at)) / 60.0
                         FROM jobs j WHERE j.id = $2),
                    avg_response_time)
                ),
                updated_at = NOW()
             WHERE worker_id = $1`,
            [workerId, jobId]
        );

        const workerService = require('./worker.service');
        await workerService.updateLastJobEventAt(workerId);
    }

    async onComplete(userId, workerId, jobId, metadata) {
        const workerService = require('./worker.service');
        await workerService.updateFatigueScore(workerId, 'JOB_COMPLETED');
        await workerService.updateLastJobEventAt(workerId);

        await db.query(
            `INSERT INTO user_worker_affinity (user_id, worker_id, hire_count, last_hired_at)
             VALUES ($1, $2, 1, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, worker_id) 
             DO UPDATE SET hire_count = user_worker_affinity.hire_count + 1, last_hired_at = CURRENT_TIMESTAMP`,
            [userId, workerId]
        );
    }

    async onReject(userId, workerId, jobId, metadata) {
        const workerService = require('./worker.service');
        await workerService.updateFatigueScore(workerId, 'JOB_REJECTED');
        await workerService.updateLastJobEventAt(workerId);
    }

    async onCancel(userId, workerId, jobId, metadata) {
        const workerService = require('./worker.service');
        await workerService.updateFatigueScore(workerId, 'JOB_CANCELLED');
        await workerService.updateLastJobEventAt(workerId);
    }

    async onRate(userId, workerId, jobId, metadata) {
        await db.query(
            `UPDATE worker_features SET
                avg_rating = (
                    SELECT (SUM(rating) + 15)::decimal / (COUNT(*) + 3)
                    FROM ratings WHERE to_id = $1 AND rating_type = 'USER_TO_WORKER'
                ),
                total_ratings_count = (
                    SELECT COUNT(*) FROM ratings WHERE to_id = $1 AND rating_type = 'USER_TO_WORKER'
                ),
                updated_at = NOW()
             WHERE worker_id = $1`,
            [workerId]
        );
    }

    async getWorkerFeedbackSummary(workerId) {
        try {
            const res = await db.query(`
                SELECT
                    action_type,
                    COUNT(*) as count,
                    AVG(action_value) as avg_value,
                    MAX(created_at) as last_event
                FROM ranking_clicks
                WHERE worker_id = $1 AND created_at > NOW() - INTERVAL '30 days'
                GROUP BY action_type
            `, [workerId]);
            return res.rows;
        } catch (err) {
            console.error('[FEEDBACK] Summary error:', err.message);
            return [];
        }
    }
}

module.exports = new FeedbackService();
