const db = require('../config/db');
const redis = require('../config/redis');
const gamificationConfig = require('../config/gamification.config');

class GamificationService {
    constructor() {
        // Subscribe to event stream for automated event-driven evaluation
        // Deferred to avoid circular dependencies during initial module load
        setImmediate(() => {
            try {
                const eventStream = require('../utils/event_stream');
                eventStream.on('job_completed', async (data) => {
                    if (data.workerId) {
                        await this.evaluateWorker(data.workerId).catch(() => {});
                    }
                });
                eventStream.on('feedback_received', async (data) => {
                    if (data.workerId) {
                        await this.evaluateWorker(data.workerId).catch(() => {});
                    }
                });
            } catch (err) {
                console.warn("[GAMIFICATION-EVENT-WARN] Event stream subscription failed:", err.message);
            }
        });
    }

    /**
     * Evaluates a worker's achievements using precomputed features (optimizes database scans)
     */
    async evaluateWorker(workerId) {
        // 1. Fetch precomputed features (avoiding 6 expensive sequential aggregate queries)
        const featureStoreService = require('./feature_store.service');
        const features = await featureStoreService.getWorkerFeatures(workerId);

        // Fetch remaining weekend stats & offers count in parallel
        const now = new Date();
        const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
        
        const [weekendRes, offersRes] = await Promise.all([
            db.query(
                "SELECT COUNT(*)::int as count FROM jobs WHERE worker_id = $1 AND status = 'COMPLETED' AND EXTRACT(ISODOW FROM COALESCE(completed_at, created_at)) IN (6, 7)", 
                [workerId]
            ),
            db.query(
                "SELECT COUNT(*)::int as count FROM job_offers WHERE worker_id = $1", 
                [workerId]
            )
        ]);

        const weekendJobs = weekendRes.rows[0]?.count || 0;
        const totalOffers = offersRes.rows[0]?.count || 0;
        
        const completedJobs = features.total_ratings_count || 0; // rating count approximation or features.jobs_completed
        // Query completed jobs count directly from jobs table to be precise
        const jobsCountRes = await db.query("SELECT COUNT(*)::int as count FROM jobs WHERE worker_id = $1 AND status = 'COMPLETED'", [workerId]);
        const actualCompletedJobs = jobsCountRes.rows[0]?.count || 0;

        const evaluations = [];
        const progress = {};

        // 2. Evaluate rules dynamically based on configuration
        for (const [type, ach] of Object.entries(gamificationConfig.achievements)) {
            let eligible = false;
            let current = 0;
            let target = 1;

            if (type === 'FAST_RESPONDER') {
                target = ach.rules.minOffers;
                current = totalOffers;
                eligible = totalOffers >= ach.rules.minOffers && features.avg_response_time < ach.rules.maxResponseSec;
            } else if (type === 'TOP_RATED') {
                target = ach.rules.minRatings;
                current = features.total_ratings_count;
                eligible = features.total_ratings_count >= ach.rules.minRatings && features.avg_rating >= ach.rules.minRating;
            } else if (type === 'RELIABLE_PROFESSIONAL') {
                target = ach.rules.minJobs;
                current = actualCompletedJobs;
                eligible = actualCompletedJobs >= ach.rules.minJobs && features.cancellation_rate < ach.rules.maxCancellationRate;
            } else if (type === 'WEEKEND_HERO') {
                target = ach.rules.minWeekendJobs;
                current = weekendJobs;
                eligible = actualCompletedJobs >= ach.rules.minJobs && weekendJobs >= ach.rules.minWeekendJobs;
            } else if (type === 'RISING_STAR') {
                target = ach.rules.minJobs;
                current = actualCompletedJobs;
                eligible = actualCompletedJobs >= ach.rules.minJobs && features.avg_rating >= ach.rules.minRating && features.completion_rate >= ach.rules.minCompletionRate;
            }

            evaluations.push({ type, check: eligible, details: ach });
            progress[type] = {
                title: ach.title,
                current,
                target,
                percentage: Math.min(100, Math.round((current / target) * 100))
            };
        }

        // Remove ineligible achievements
        const ineligibleTypes = evaluations.filter(ev => !ev.check).map(ev => ev.type);
        if (ineligibleTypes.length > 0) {
            await db.query(
                "DELETE FROM worker_achievements WHERE worker_id = $1 AND achievement_type = ANY($2)",
                [workerId, ineligibleTypes]
            );
        }

        // Insert new achievements using bulk parameters if possible, or simple checks
        for (const ev of evaluations) {
            if (!ev.check) continue;
            await db.query(`
                INSERT INTO worker_achievements (worker_id, achievement_type, title, description, icon, awarded_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (worker_id, achievement_type) DO NOTHING
            `, [workerId, ev.type, ev.details.title, ev.details.desc, ev.details.icon]);
        }

        return { workerId, progress };
    }

    async getWorkerAchievements(workerId) {
        const res = await db.query(
            "SELECT * FROM worker_achievements WHERE worker_id = $1 ORDER BY awarded_at DESC",
            [workerId]
        );
        return res.rows;
    }

    /**
     * Get Leaderboard with Redis caching support (reduces DB lookup workload)
     */
    async getLeaderboard(category = null, limit = 20) {
        const cacheKey = `leaderboard:${category || 'global'}:${limit}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (err) {}

        let query = `
            SELECT w.id, w.full_name, w.photo_url,
                   COUNT(DISTINCT wa.id) as achievements_count,
                   COALESCE(r.overall_score, 50) as reputation_score
            FROM workers w
            LEFT JOIN worker_achievements wa ON wa.worker_id = w.id
            LEFT JOIN worker_reputation_scores r ON r.worker_id = w.id
        `;
        const params = [];
        if (category) {
            query += " WHERE w.skills ? $1 OR $1 = ANY(w.tasks)";
            params.push(category);
        }
        query += " GROUP BY w.id, w.full_name, w.photo_url, r.overall_score ORDER BY achievements_count DESC, reputation_score DESC LIMIT $" + (params.length + 1);
        params.push(limit);
        
        const res = await db.query(query, params);
        const rows = res.rows;

        try {
            await redis.set(cacheKey, JSON.stringify(rows), 'EX', gamificationConfig.leaderboardCacheTtl);
        } catch (err) {}

        return rows;
    }
}

module.exports = new GamificationService();
