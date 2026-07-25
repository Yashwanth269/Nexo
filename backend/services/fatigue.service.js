const db = require('../config/db');
const redis = require('../config/redis');
const fatigueConfig = require('../config/fatigue.config');

class FatigueService {
    /**
     * Gathers stress events, active jobs, online durations, and computes composite fatigue
     */
    async calculateAdvancedFatigue(workerId) {
        const cacheKey = `worker:${workerId}:fatigue:cache`;
        
        // 1. Try reading from cache first
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (cacheErr) {
            console.warn("[FATIGUE-CACHE-WARN] Redis read failed:", cacheErr.message);
        }

        const now = new Date();
        const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

        // 2. Parallel queries execution (removes latency bottleneck)
        const [
            jobsRes,
            stressRes,
            activeRes,
            offersRes,
            hoursOnline
        ] = await Promise.all([
            db.query(`
                SELECT COUNT(*) as completed_24h,
                       COALESCE(SUM(route_distance), 0) as total_distance
                FROM jobs WHERE worker_id = $1 AND status = 'COMPLETED' AND completed_at > $2
            `, [workerId, dayAgo]),
            db.query(`
                SELECT COUNT(*) as stress_events FROM event_logs
                WHERE worker_id = $1 AND event_type IN ('CANCELLATION', 'DISPUTE', 'COMPLAINT', 'NO_SHOW')
                AND created_at > $2
            `, [workerId, dayAgo]),
            db.query(
                "SELECT COUNT(*) as active FROM jobs WHERE worker_id = $1 AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS')",
                [workerId]
            ),
            db.query(
                "SELECT COUNT(*) as offers_24h FROM job_offers WHERE worker_id = $1 AND created_at > $2",
                [workerId, dayAgo]
            ),
            this._estimateOnlineHours(workerId, dayAgo)
        ]);

        const jobs = jobsRes.rows[0];
        const completed24h = parseInt(jobs.completed_24h || 0, 10);
        const travelDistance = parseFloat(jobs.total_distance || 0);
        const stressEvents = parseInt(stressRes.rows[0]?.stress_events || 0, 10);
        const activeJobs = parseInt(activeRes.rows[0]?.active || 0, 10);
        const offerLoad = parseInt(offersRes.rows[0]?.offers_24h || 0, 10);

        // 3. Multi-Factor Formula
        const w = fatigueConfig.weights;
        let score = 0;
        score += Math.min(w.completedJobs, completed24h * 0.05);
        score += Math.min(w.hoursOnline, (hoursOnline / 24) * w.hoursOnline);
        score += Math.min(w.travelDistance, (travelDistance / 100) * w.travelDistance);
        score += Math.min(w.offerLoad, offerLoad * 0.03);
        score += Math.min(w.activeJobs, activeJobs * 0.08);
        score += Math.min(w.stressEvents, stressEvents * 0.10);

        // 4. Context-Aware Modifiers (Night Shift / Consecutive Days)
        const hour = now.getHours();
        if (hour >= 22 || hour <= 5) {
            score *= fatigueConfig.contextMultipliers.nightShift;
        }

        score = Math.min(1.0, Math.round(score * 10000) / 10000);
        const band = score >= 0.70 ? 'CRITICAL' : score >= 0.50 ? 'HIGH' : score >= 0.30 ? 'MODERATE' : score >= 0.15 ? 'LOW' : 'NONE';

        const result = { score, band, activeJobs, completed24h, hoursOnline: Math.round(hoursOnline * 100) / 100 };

        // Save status in DB
        await db.query(`
            INSERT INTO advanced_fatigue_scores (worker_id, hours_online_24h, jobs_completed_24h, travel_distance_24h_km,
                acceptance_load_24h, active_jobs_current, stress_events_24h, fatigue_score, fatigue_band)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (worker_id) DO UPDATE SET
                hours_online_24h = EXCLUDED.hours_online_24h,
                jobs_completed_24h = EXCLUDED.jobs_completed_24h,
                travel_distance_24h_km = EXCLUDED.travel_distance_24h_km,
                acceptance_load_24h = EXCLUDED.acceptance_load_24h,
                active_jobs_current = EXCLUDED.active_jobs_current,
                stress_events_24h = EXCLUDED.stress_events_24h,
                fatigue_score = EXCLUDED.fatigue_score,
                fatigue_band = EXCLUDED.fatigue_band,
                calculated_at = NOW()
        `, [workerId, result.hoursOnline, completed24h, Math.round(travelDistance * 100) / 100,
            offerLoad, activeJobs, stressEvents, score, band]);

        // 5. Cache result to avoid write and query amplification
        try {
            await redis.set(cacheKey, JSON.stringify(result), 'EX', fatigueConfig.cacheTtlSeconds);
        } catch (err) {}

        return result;
    }

    /**
     * Safe estimation of online hours (handles duplicate logs, crash reconnects, missing events)
     */
    async _estimateOnlineHours(workerId, since) {
        const events = await db.query(`
            SELECT event_type, created_at FROM event_logs
            WHERE worker_id = $1 AND event_type IN ('worker_online', 'worker_offline') AND created_at > $2
            ORDER BY created_at ASC
        `, [workerId, since]);

        let totalMinutes = 0;
        let lastOnline = null;

        for (const ev of events.rows) {
            if (ev.event_type === 'worker_online') {
                // Handle duplicate online sequences (keep original start)
                if (!lastOnline) {
                    lastOnline = new Date(ev.created_at);
                }
            } else if (ev.event_type === 'worker_offline') {
                if (lastOnline) {
                    const diffMins = (new Date(ev.created_at) - lastOnline) / 60000;
                    // Cap extreme session length in case of server crashes or missing event sequences
                    totalMinutes += Math.min(diffMins, fatigueConfig.maxOnlineHoursPerDay * 60);
                    lastOnline = null;
                }
            }
        }
        
        // If still online, compute up to present
        if (lastOnline) {
            const diffMins = (Date.now() - lastOnline) / 60000;
            totalMinutes += Math.min(diffMins, fatigueConfig.maxOnlineHoursPerDay * 60);
        }

        return Math.min(fatigueConfig.maxOnlineHoursPerDay, totalMinutes / 60);
    }
}

module.exports = new FatigueService();
