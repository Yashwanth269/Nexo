const db = require('../config/db');
const redis = require('../config/redis');

class FatigueService {
    async calculateAdvancedFatigue(workerId) {
        const now = new Date();
        const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

        const jobsRes = await db.query(`
            SELECT COUNT(*) as completed_24h,
                   COALESCE(SUM(route_distance), 0) as total_distance
            FROM jobs WHERE worker_id = $1 AND status = 'COMPLETED' AND completed_at > $2
        `, [workerId, dayAgo]);
        const jobs = jobsRes.rows[0];

        const stressRes = await db.query(`
            SELECT COUNT(*) as stress_events FROM event_logs
            WHERE worker_id = $1 AND event_type IN ('CANCELLATION', 'DISPUTE', 'COMPLAINT', 'NO_SHOW')
            AND created_at > $2
        `, [workerId, dayAgo]);

        const activeRes = await db.query(
            "SELECT COUNT(*) as active FROM jobs WHERE worker_id = $1 AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS')",
            [workerId]
        );

        const offersRes = await db.query(
            "SELECT COUNT(*) as offers_24h FROM job_offers WHERE worker_id = $1 AND created_at > $2",
            [workerId, dayAgo]
        );

        const hoursOnline = await this._estimateOnlineHours(workerId, dayAgo);

        const completed24h = parseInt(jobs.completed_24h || 0);
        const travelDistance = parseFloat(jobs.total_distance || 0);
        const stressEvents = parseInt(stressRes.rows[0]?.stress_events || 0);
        const activeJobs = parseInt(activeRes.rows[0]?.active || 0);
        const offerLoad = parseInt(offersRes.rows[0]?.offers_24h || 0);

        let score = 0;
        score += Math.min(0.25, completed24h * 0.05);
        score += Math.min(0.20, (hoursOnline / 24) * 0.20);
        score += Math.min(0.15, travelDistance / 100 * 0.15);
        score += Math.min(0.15, offerLoad * 0.03);
        score += Math.min(0.20, activeJobs * 0.08);
        score += Math.min(0.20, stressEvents * 0.10);

        score = Math.min(1, Math.round(score * 10000) / 10000);
        const band = score >= 0.70 ? 'CRITICAL' : score >= 0.50 ? 'HIGH' : score >= 0.30 ? 'MODERATE' : score >= 0.15 ? 'LOW' : 'NONE';

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
        `, [workerId, Math.round(hoursOnline * 100) / 100, completed24h, Math.round(travelDistance * 100) / 100,
            offerLoad, activeJobs, stressEvents, score, band]);

        return { score, band, activeJobs, completed24h, hoursOnline };
    }

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
                lastOnline = new Date(ev.created_at);
            } else if (ev.event_type === 'worker_offline' && lastOnline) {
                totalMinutes += (new Date(ev.created_at) - lastOnline) / 60000;
                lastOnline = null;
            }
        }
        if (lastOnline) {
            totalMinutes += (Date.now() - lastOnline) / 60000;
        }
        return totalMinutes / 60;
    }
}

module.exports = new FatigueService();
