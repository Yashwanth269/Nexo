const db = require('../config/db');
const redis = require('../config/redis');

const WORKER_CACHE_TTL = 1800;
const JOB_CACHE_TTL = 1800;

class FeatureStoreService {
    async getWorkerFeatures(workerId) {
        const cacheKey = `worker:features:${workerId}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                await redis.expire(cacheKey, WORKER_CACHE_TTL);
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('[FEATURE_STORE] Redis read failed:', err.message);
        }

        try {
            const res = await db.query(
                `SELECT * FROM worker_features WHERE worker_id = $1`,
                [workerId]
            );

            let features;
            if (res.rowCount > 0) {
                const row = res.rows[0];
                const acceptanceRate = row.completion_rate !== null && row.completion_rate > 0
                    ? parseFloat(row.completion_rate) / 100.0
                    : 1.0;
                features = {
                    worker_id: row.worker_id,
                    completion_rate: parseFloat(row.completion_rate || 100.0),
                    cancellation_rate: parseFloat(row.cancellation_rate || 0.0),
                    avg_rating: parseFloat(row.avg_rating || 4.5),
                    total_ratings_count: parseInt(row.total_ratings_count || 0),
                    avg_response_time: parseFloat(row.avg_response_time || 2.0),
                    reliability_score: parseFloat(row.reliability_score || 1.0),
                    eta_confidence_score: parseFloat(row.eta_confidence_score || 0.95),
                    worker_load_score: parseFloat(row.worker_load_score || 0.0),
                    active_jobs_count: parseInt(row.active_jobs_count || 0),
                    fatigue_score: parseFloat(row.fatigue_score || 0.0),
                    fatigue_24h: parseFloat(row.fatigue_24h || 0.0),
                    fatigue_7d: parseFloat(row.fatigue_7d || 0.0),
                    fatigue_30d: parseFloat(row.fatigue_30d || 0.0),
                    fraud_risk_score: parseFloat(row.fraud_risk_score || 0.0),
                    is_shadow_banned: row.is_shadow_banned || false,
                    trust_decay_factor: parseFloat(row.trust_decay_factor || 1.0),
                    last_job_event_at: row.last_job_event_at || row.last_event_at,
                    acceptance_rate: acceptanceRate,
                    online_consistency: 1.0,
                };
            } else {
                features = this.getDefaultWorkerFeatures(workerId);
            }

            const fatigue24h = await redis.get(`worker:${workerId}:rejections`) || '0';
            const ignored = await redis.get(`worker:${workerId}:ignored`) || '0';
            const timeouts = await redis.get(`worker:${workerId}:timeouts`) || '0';

            const rCount = parseInt(fatigue24h);
            const iCount = parseInt(ignored);
            const tCount = parseInt(timeouts);
            const z = (0.4 * rCount) + (0.3 * iCount) + (0.2 * tCount) - 2.0;
            features.fatigue_24h = Math.min(1.0, 1 / (1 + Math.exp(-z)));

            await redis.set(cacheKey, JSON.stringify(features), 'EX', WORKER_CACHE_TTL);
            return features;
        } catch (err) {
            console.error('[FEATURE_STORE] DB read failed:', err.message);
            return this.getDefaultWorkerFeatures(workerId);
        }
    }

    getDefaultWorkerFeatures(workerId) {
        return {
            worker_id: workerId,
            completion_rate: 100.0,
            cancellation_rate: 0.0,
            avg_rating: 4.5,
            total_ratings_count: 0,
            avg_response_time: 2.0,
            reliability_score: 1.0,
            eta_confidence_score: 0.95,
            worker_load_score: 0.0,
            active_jobs_count: 0,
            fatigue_score: 0.0,
            fatigue_24h: 0.0,
            fatigue_7d: 0.0,
            fatigue_30d: 0.0,
            fraud_risk_score: 0.0,
            is_shadow_banned: false,
            trust_decay_factor: 1.0,
            last_job_event_at: new Date().toISOString(),
            acceptance_rate: 1.0,
            online_consistency: 0.5,
        };
    }

    async getJobFeatures(jobId) {
        const cacheKey = `job:features:${jobId}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                await redis.expire(cacheKey, JOB_CACHE_TTL);
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('[FEATURE_STORE] Redis job read failed:', err.message);
        }

        try {
            const res = await db.query(
                `SELECT j.*, jf.demand_pressure, jf.avg_response_time as jf_avg_response_time
                 FROM jobs j
                 LEFT JOIN job_features jf ON j.id = jf.job_id
                 WHERE j.id = $1`,
                [jobId]
            );

            let features;
            if (res.rowCount > 0) {
                const job = res.rows[0];
                const isUrgent = ['REDISTRIBUTING', 'REASSIGNING'].includes(job.status) || job.urgency === 'urgent';
                features = {
                    job_id: job.id,
                    category: job.category,
                    urgency: job.urgency || 'normal',
                    price: parseFloat(job.price || 0),
                    schedule_type: job.schedule_type || 'now',
                    location_lat: parseFloat(job.location_lat || 0),
                    location_lng: parseFloat(job.location_lng || 0),
                    demand_pressure: parseFloat(job.demand_pressure || 0.0),
                    isUrgent,
                    status: job.status,
                    created_at: job.created_at,
                };
            } else {
                features = {
                    job_id: jobId,
                    category: 'General',
                    urgency: 'normal',
                    price: 0,
                    schedule_type: 'now',
                    location_lat: 0,
                    location_lng: 0,
                    demand_pressure: 0.0,
                    isUrgent: false,
                    status: 'OPEN',
                    created_at: new Date().toISOString(),
                };
            }

            await redis.set(cacheKey, JSON.stringify(features), 'EX', JOB_CACHE_TTL);
            return features;
        } catch (err) {
            console.error('[FEATURE_STORE] Job read failed:', err.message);
            return {
                job_id: jobId,
                category: 'General',
                urgency: 'normal',
                price: 0,
                schedule_type: 'now',
                location_lat: 0,
                location_lng: 0,
                demand_pressure: 0.0,
                isUrgent: false,
                status: 'OPEN',
                created_at: new Date().toISOString(),
            };
        }
    }

    async setWorkerFeatures(workerId, features) {
        try {
            await db.query(`
                INSERT INTO worker_features (
                    worker_id, completion_rate, cancellation_rate, avg_rating, total_ratings_count,
                    avg_response_time, reliability_score, eta_confidence_score, worker_load_score,
                    active_jobs_count, fatigue_score, fatigue_24h, fatigue_7d, fatigue_30d,
                    fraud_risk_score, is_shadow_banned, trust_decay_factor, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
                ON CONFLICT (worker_id) DO UPDATE SET
                    completion_rate = EXCLUDED.completion_rate,
                    cancellation_rate = EXCLUDED.cancellation_rate,
                    avg_rating = EXCLUDED.avg_rating,
                    total_ratings_count = EXCLUDED.total_ratings_count,
                    avg_response_time = EXCLUDED.avg_response_time,
                    reliability_score = EXCLUDED.reliability_score,
                    eta_confidence_score = EXCLUDED.eta_confidence_score,
                    worker_load_score = EXCLUDED.worker_load_score,
                    active_jobs_count = EXCLUDED.active_jobs_count,
                    fatigue_score = EXCLUDED.fatigue_score,
                    fatigue_24h = EXCLUDED.fatigue_24h,
                    fatigue_7d = EXCLUDED.fatigue_7d,
                    fatigue_30d = EXCLUDED.fatigue_30d,
                    fraud_risk_score = EXCLUDED.fraud_risk_score,
                    is_shadow_banned = EXCLUDED.is_shadow_banned,
                    trust_decay_factor = EXCLUDED.trust_decay_factor,
                    updated_at = NOW()
            `, [
                workerId,
                features.completion_rate || 100.0,
                features.cancellation_rate || 0.0,
                features.avg_rating || 4.5,
                features.total_ratings_count || 0,
                features.avg_response_time || 2.0,
                features.reliability_score || 1.0,
                features.eta_confidence_score || 0.95,
                features.worker_load_score || 0.0,
                features.active_jobs_count || 0,
                features.fatigue_score || 0.0,
                features.fatigue_24h || 0.0,
                features.fatigue_7d || 0.0,
                features.fatigue_30d || 0.0,
                features.fraud_risk_score || 0.0,
                features.is_shadow_banned || false,
                features.trust_decay_factor || 1.0,
            ]);
            await this.invalidateWorkerFeatures(workerId);
        } catch (err) {
            console.error('[FEATURE_STORE] Set worker features failed:', err.message);
        }
    }

    async setJobFeatures(jobId, features) {
        try {
            await db.query(`
                INSERT INTO job_features (job_id, category, urgency, price, schedule_type, location_lat, location_lng, demand_pressure, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (job_id) DO UPDATE SET
                    category = EXCLUDED.category,
                    urgency = EXCLUDED.urgency,
                    price = EXCLUDED.price,
                    schedule_type = EXCLUDED.schedule_type,
                    location_lat = EXCLUDED.location_lat,
                    location_lng = EXCLUDED.location_lng,
                    demand_pressure = EXCLUDED.demand_pressure,
                    updated_at = NOW()
            `, [
                jobId,
                features.category || 'General',
                features.urgency || 'normal',
                features.price || 0,
                features.schedule_type || 'now',
                features.location_lat || 0,
                features.location_lng || 0,
                features.demand_pressure || 0.0,
            ]);
            await this.invalidateJobFeatures(jobId);
        } catch (err) {
            console.error('[FEATURE_STORE] Set job features failed:', err.message);
        }
    }

    async invalidateWorkerFeatures(workerId) {
        await redis.del(`worker:features:${workerId}`).catch(() => {});
    }

    async invalidateJobFeatures(jobId) {
        await redis.del(`job:features:${jobId}`).catch(() => {});
    }
}

module.exports = new FeatureStoreService();
