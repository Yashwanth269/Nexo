/**
 * Nexo Admin Dispatch Observability & Metrics Routes
 * 
 * Exposes real-time health, dispatch analytics, acceptance rates,
 * search radius statistics, and system observability metrics.
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const redis = require('../config/redis');
const dispatchConfig = require('../config/dispatch.config');

/**
 * GET /api/admin/dispatch/metrics
 * Returns comprehensive dispatch engine performance metrics.
 */
router.get('/metrics', async (req, res) => {
    try {
        const timeframeHours = parseInt(req.query.hours || '24', 10);

        // 1. Overall Dispatch Volume & Conversion
        const statsRes = await db.query(`
            SELECT 
                COUNT(*) AS total_jobs_created,
                COUNT(CASE WHEN status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS', 'COMPLETED') THEN 1 END) AS total_assigned,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS total_completed,
                COUNT(CASE WHEN status = 'EXPIRED' THEN 1 END) AS total_expired,
                COUNT(CASE WHEN status = 'REDISTRIBUTING' THEN 1 END) AS total_redistributing,
                AVG(CASE WHEN accepted_at IS NOT NULL THEN EXTRACT(EPOCH FROM (accepted_at - created_at)) END) AS avg_assignment_time_sec
            FROM jobs
            WHERE created_at >= NOW() - ($1 || ' hours')::INTERVAL
        `, [timeframeHours]);

        const stats = statsRes.rows[0];
        const totalCreated = parseInt(stats.total_jobs_created || '0', 10);
        const totalAssigned = parseInt(stats.total_assigned || '0', 10);
        const assignmentRatePct = totalCreated > 0 ? ((totalAssigned / totalCreated) * 100).toFixed(1) : '0.0';

        // 2. Offer Breakdown (Accepted, Rejected, Timed Out)
        const offerStatsRes = await db.query(`
            SELECT 
                COUNT(*) AS total_offers_sent,
                COUNT(CASE WHEN status = 'ACCEPTED' THEN 1 END) AS offers_accepted,
                COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) AS offers_rejected,
                COUNT(CASE WHEN status = 'EXPIRED' THEN 1 END) AS offers_expired
            FROM job_offers
            WHERE created_at >= NOW() - ($1 || ' hours')::INTERVAL
        `, [timeframeHours]);
        const offerStats = offerStatsRes.rows[0];

        // 3. Radius & Search Analytics Logs
        const searchRes = await db.query(`
            SELECT 
                AVG(initial_radius_km) AS avg_initial_radius,
                AVG(expansion_count) AS avg_expansions,
                AVG(workers_found) AS avg_workers_found,
                AVG(workers_ranked) AS avg_workers_ranked,
                AVG(notifications_sent) AS avg_notifications_sent,
                AVG(dispatch_time_seconds) AS avg_dispatch_time_sec
            FROM search_analytics_logs
            WHERE created_at >= NOW() - ($1 || ' hours')::INTERVAL
        `, [timeframeHours]);

        res.json({
            success: true,
            timeframeHours,
            overview: {
                totalJobsCreated: totalCreated,
                totalAssigned,
                totalCompleted: parseInt(stats.total_completed || '0', 10),
                totalExpired: parseInt(stats.total_expired || '0', 10),
                totalRedistributing: parseInt(stats.total_redistributing || '0', 10),
                assignmentSuccessRatePct: parseFloat(assignmentRatePct),
                avgAssignmentTimeSeconds: Math.round(parseFloat(stats.avg_assignment_time_sec || '0'))
            },
            offers: {
                totalSent: parseInt(offerStats.total_offers_sent || '0', 10),
                accepted: parseInt(offerStats.offers_accepted || '0', 10),
                rejected: parseInt(offerStats.offers_rejected || '0', 10),
                expired: parseInt(offerStats.offers_expired || '0', 10)
            },
            searchAnalytics: {
                avgInitialRadiusKm: parseFloat(searchRes.rows[0]?.avg_initial_radius || '3.0').toFixed(1),
                avgExpansions: parseFloat(searchRes.rows[0]?.avg_expansions || '0').toFixed(1),
                avgWorkersFound: Math.round(parseFloat(searchRes.rows[0]?.avg_workers_found || '0')),
                avgWorkersRanked: Math.round(parseFloat(searchRes.rows[0]?.avg_workers_ranked || '0')),
                avgNotificationsSent: Math.round(parseFloat(searchRes.rows[0]?.avg_notifications_sent || '0')),
                avgDispatchTimeSeconds: Math.round(parseFloat(searchRes.rows[0]?.avg_dispatch_time_sec || '0'))
            },
            config: dispatchConfig
        });
    } catch (e) {
        console.error('[ADMIN-METRICS-ERROR]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/admin/dispatch/health
 * Returns engine health status, Redis connection state, active socket rooms, and worker supply count.
 */
router.get('/health', async (req, res) => {
    try {
        const activeWorkersCount = await redis.scard('workers:active_set').catch(() => 0);
        const redisStatus = redis.isOpen ? 'HEALTHY' : 'DISCONNECTED';

        const dbCheck = await db.query('SELECT COUNT(*) FROM workers WHERE is_online = true AND is_available = true');
        const onlineAvailableWorkers = parseInt(dbCheck.rows[0]?.count || '0', 10);

        res.json({
            success: true,
            status: redis.isOpen ? 'UP' : 'DEGRADED',
            components: {
                database: 'HEALTHY',
                redis: redisStatus,
                activeGeohashWorkers: activeWorkersCount,
                onlineAvailableWorkers
            },
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
