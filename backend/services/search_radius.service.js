const db = require('../config/db');
const redis = require('../config/redis');

const BASE_RADIUS = 15;
const MIN_RADIUS = 3;
const MAX_RADIUS = 50;

class SearchRadiusService {
    async calculateRadius(lat, lng, category = null) {
        const activeWorkers = parseInt(await redis.get('metrics:active_workers') || '0');
        const pendingJobs = parseInt(await redis.get('metrics:pending_jobs') || '0');
        const supply = Math.max(1, activeWorkers);
        const demand = Math.max(1, pendingJobs);
        const ratio = demand / supply;

        const hour = new Date().getHours();
        const isPeakHours = (hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21);

        let radius = BASE_RADIUS;
        if (ratio > 1.5) {
            radius = BASE_RADIUS * 1.5;
        } else if (ratio > 1.0) {
            radius = BASE_RADIUS * 1.2;
        } else if (ratio < 0.3) {
            radius = BASE_RADIUS * 0.7;
        }
        if (isPeakHours) radius *= 0.8;
        if (category) {
            const catRes = await db.query(
                "SELECT COUNT(*) as count FROM workers w WHERE w.is_online = true AND (w.skills ? $1 OR $1 = ANY(w.tasks))",
                [category]
            );
            const catWorkers = parseInt(catRes.rows[0]?.count || '0');
            if (catWorkers < 5) radius *= 1.3;
            if (catWorkers > 50) radius *= 0.8;
        }
        radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(radius)));
        return radius;
    }

    async logRadius(jobId, category, baseRadius, adjustedRadius, demandPressure, workerSupply, candidatesFound) {
        try {
            await db.query(`
                INSERT INTO search_radius_log (job_id, category, base_radius_km, adjusted_radius_km, demand_pressure, worker_supply, hour_of_day, candidates_found)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [jobId, category, baseRadius, adjustedRadius, demandPressure, workerSupply, new Date().getHours(), candidatesFound]);
        } catch (e) {
            // Non-critical
        }
    }
}

module.exports = new SearchRadiusService();
