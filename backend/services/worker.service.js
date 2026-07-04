const db = require('../config/db');
const redis = require('../config/redis');
const featureStore = require('./feature_store.service');

class WorkerService {
    async updateFatigueScore(workerId, eventType) {
        const key24h = `worker:${workerId}:fatigue_24h`;
        const key7d = `worker:${workerId}:fatigue_7d`;
        const key30d = `worker:${workerId}:fatigue_30d`;

        const PENALTY_MAP = {
            'JOB_REJECTED': { rejections: 1, ignored: 0, timeouts: 0 },
            'JOB_IGNORED': { rejections: 0, ignored: 1, timeouts: 0 },
            'JOB_CANCELLED': { rejections: 0, ignored: 0, timeouts: 1 },
            'JOB_TIMEOUT': { rejections: 0, ignored: 0, timeouts: 1 },
            'JOB_COMPLETED': { rejections: -1, ignored: 0, timeouts: 0 },
        };

        const delta = PENALTY_MAP[eventType] || { rejections: 0, ignored: 0, timeouts: 0 };

        if (delta.rejections > 0) {
            await redis.incr(`worker:${workerId}:rejections`);
            await redis.expire(`worker:${workerId}:rejections`, 2592000);
        } else if (delta.rejections < 0) {
            const val = parseInt(await redis.get(`worker:${workerId}:rejections`) || '1');
            await redis.set(`worker:${workerId}:rejections`, Math.max(0, val - 1));
        }
        if (delta.ignored > 0) {
            await redis.incr(`worker:${workerId}:ignored`);
            await redis.expire(`worker:${workerId}:ignored`, 2592000);
        }
        if (delta.timeouts > 0) {
            await redis.incr(`worker:${workerId}:timeouts`);
            await redis.expire(`worker:${workerId}:timeouts`, 2592000);
        }

        const fatigue = await this.calculateFatigueScore(workerId);

        await db.query(`
            UPDATE worker_features SET
                fatigue_24h = $1, fatigue_7d = $2, fatigue_30d = $3,
                fatigue_score = $4, updated_at = NOW()
            WHERE worker_id = $5
        `, [fatigue['24h'], fatigue['7d'], fatigue['30d'], fatigue.composite, workerId]);

        if (eventType === 'JOB_CANCELLED') {
            await db.query(`
                UPDATE workers
                SET reliability_score = GREATEST(0, reliability_score - 0.1),
                    cancellation_count = COALESCE(cancellation_count, 0) + 1
                WHERE id = $1
            `, [workerId]);
        } else if (eventType === 'JOB_COMPLETED') {
            await db.query(`
                UPDATE workers
                SET reliability_score = LEAST(1.0, reliability_score + 0.05),
                    completion_count = COALESCE(completion_count, 0) + 1,
                    jobs_completed = jobs_completed + 1
                WHERE id = $1
            `, [workerId]);
        }

        await this.recomputeAndStoreFeatures(workerId);
        await this.updateLastJobEventAt(workerId);

        return fatigue;
    }

    async calculateFatigueScore(workerId) {
        const now = Math.floor(Date.now() / 1000);
        const windows = { '24h': 86400, '7d': 604800, '30d': 2592000 };
        const results = {};

        for (const [label, seconds] of Object.entries(windows)) {
            const since = now - seconds;
            let rCount = parseInt(await redis.get(`worker:${workerId}:rejections`) || 0);
            let iCount = parseInt(await redis.get(`worker:${workerId}:ignored`) || 0);
            let tCount = parseInt(await redis.get(`worker:${workerId}:timeouts`) || 0);
            const z = (0.4 * rCount) + (0.3 * iCount) + (0.2 * tCount) - 2.0;
            results[label] = Math.min(1.0, 1 / (1 + Math.exp(-z)));
        }

        results.composite = (results['24h'] * 0.6) + (results['7d'] * 0.3) + (results['30d'] * 0.1);
        return results;
    }

    async updateLastJobEventAt(workerId) {
        try {
            await db.query(
                `UPDATE worker_features SET last_job_event_at = CURRENT_TIMESTAMP WHERE worker_id = $1`,
                [workerId]
            );
            const cacheKey = `worker:features:${workerId}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                data.last_job_event_at = new Date().toISOString();
                await redis.set(cacheKey, JSON.stringify(data), 'EX', 1800);
            }
        } catch (err) {
            console.warn('[WORKER-SERVICE] Failed to update last_job_event_at:', err.message);
        }
    }

    async recomputeAndStoreFeatures(workerId) {
        try {
            const workerRes = await db.query("SELECT * FROM workers WHERE id = $1", [workerId]);
            const worker = workerRes.rows[0];
            if (!worker) return;

            const jobsRes = await db.query(
                "SELECT status, COUNT(*) as count FROM jobs WHERE worker_id = $1 GROUP BY status",
                [workerId]
            );

            let completed = 0, cancelled = 0, total = 0;
            for (const row of jobsRes.rows) {
                const count = parseInt(row.count);
                total += count;
                if (row.status === 'COMPLETED') completed = count;
                if (row.status === 'CANCELLED') cancelled = count;
            }

            const completionRate = total > 0 ? (completed / total) * 100.0 : 100.0;
            const cancellationRate = total > 0 ? (cancelled / total) * 100.0 : 0.0;

            const ratingRes = await db.query(
                "SELECT AVG(rating) as avg, COUNT(*) as count FROM ratings WHERE to_id = $1",
                [workerId]
            );
            const avgRating = parseFloat(ratingRes.rows[0].avg || worker.rating || 4.0);
            const ratingCount = parseInt(ratingRes.rows[0].count || 0);

            const activeJobsRes = await db.query(
                "SELECT COUNT(*) as count FROM jobs WHERE worker_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED')",
                [workerId]
            );
            const activeJobs = parseInt(activeJobsRes.rows[0].count || 0);

            const fatigue = await this.calculateFatigueScore(workerId);

            const features = {
                completion_rate: completionRate,
                cancellation_rate: cancellationRate,
                avg_rating: avgRating,
                total_ratings_count: ratingCount,
                avg_response_time: parseFloat(worker.response_speed || 1.5),
                reliability_score: parseFloat(worker.reliability_score || 1.0),
                eta_confidence_score: 0.95,
                worker_load_score: activeJobs * 0.25,
                active_jobs_count: activeJobs,
                fatigue_score: fatigue.composite,
                fatigue_24h: fatigue['24h'],
                fatigue_7d: fatigue['7d'],
                fatigue_30d: fatigue['30d'],
                fraud_risk_score: 0.0,
                is_shadow_banned: false,
                trust_decay_factor: 1.0,
            };

            await featureStore.setWorkerFeatures(workerId, features);
            console.log(`[FEATURE_PIPELINE] Precomputed features for worker ${workerId}`);
        } catch (err) {
            console.error('[FEATURE-PIPELINE-ERROR]', err.message);
        }
    }

    async setRequestStatus(workerId, isPaused) {
        await redis.set(`worker:${workerId}:paused`, isPaused ? '1' : '0');
        await db.query("UPDATE workers SET is_available = $1 WHERE id = $2", [!isPaused, workerId]);
        await this.recomputeAndStoreFeatures(workerId);
    }

    async getWorkerPreferences(workerId) {
        const result = await db.query(
            "SELECT preferred_radius, job_types FROM workers WHERE id = $1",
            [workerId]
        );
        return result.rows[0];
    }

    async updatePreferences(workerId, radius, jobTypes) {
        await db.query(
            "UPDATE workers SET preferred_radius = $1, job_types = $2 WHERE id = $3",
            [radius, jobTypes, workerId]
        );
        await redis.set(`worker:${workerId}:radius`, radius);
        await this.recomputeAndStoreFeatures(workerId);
    }
}

module.exports = new WorkerService();
