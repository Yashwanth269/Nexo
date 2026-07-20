/**
 * Nexo Dynamic ML Incentive Engine
 * 
 * Recommends dynamic weekly/monthly targets, peak area multipliers,
 * and surge bonuses based on real-time marketplace demand/supply conditions.
 */

const db = require('../config/db');
const redis = require('../config/redis');

class IncentiveMLService {
    /**
     * Recommends dynamic incentive multipliers and target bonuses for a worker.
     */
    async recommendIncentives(workerId, lat, lng) {
        try {
            // 1. Calculate area demand vs supply ratio
            const activeWorkers = await redis.scard('workers:active_set').catch(() => 5);
            const openJobsRes = await db.query(
                "SELECT COUNT(*) FROM jobs WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')"
            );
            const openJobsCount = parseInt(openJobsRes.rows[0].count || '0', 10);

            // Demand/Supply Ratio
            const demandSupplyRatio = activeWorkers > 0 ? (openJobsCount / activeWorkers) : 1.0;

            let areaMultiplier = 1.0;
            if (demandSupplyRatio > 2.0) {
                areaMultiplier = 1.35; // 35% bonus during high demand
            } else if (demandSupplyRatio > 1.2) {
                areaMultiplier = 1.15; // 15% bonus during moderate demand
            }

            // 2. Fetch worker weekly stats
            const statsRes = await db.query(`
                SELECT COUNT(*) as jobs_this_week, COALESCE(SUM(price), 0) as earnings_this_week
                FROM jobs
                WHERE worker_id = $1
                  AND status = 'COMPLETED'
                  AND completed_at >= date_trunc('week', CURRENT_DATE)
            `, [workerId]);

            const jobsThisWeek = parseInt(statsRes.rows[0].jobs_this_week || '0', 10);
            const earningsThisWeek = parseFloat(statsRes.rows[0].earnings_this_week || '0');

            // Dynamic weekly milestone target
            let nextMilestoneJobs = 20;
            let milestoneReward = 500;
            if (jobsThisWeek >= 40) {
                nextMilestoneJobs = 50;
                milestoneReward = 1500;
            } else if (jobsThisWeek >= 20) {
                nextMilestoneJobs = 40;
                milestoneReward = 1000;
            }

            return {
                workerId,
                demandSupplyRatio: parseFloat(demandSupplyRatio.toFixed(2)),
                areaMultiplier: parseFloat(areaMultiplier.toFixed(2)),
                jobsThisWeek,
                earningsThisWeek: parseFloat(earningsThisWeek.toFixed(2)),
                nextMilestone: {
                    targetJobs: nextMilestoneJobs,
                    jobsRemaining: Math.max(0, nextMilestoneJobs - jobsThisWeek),
                    bonusReward: milestoneReward
                }
            };
        } catch (e) {
            console.error('[INCENTIVE-ML-ERROR]', e.message);
            return { workerId, areaMultiplier: 1.0, nextMilestone: { targetJobs: 20, jobsRemaining: 20, bonusReward: 500 } };
        }
    }
}

module.exports = new IncentiveMLService();
