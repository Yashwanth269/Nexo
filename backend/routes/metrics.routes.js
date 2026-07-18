const express = require('express');
const router = express.Router();
const db = require('../config/db');
const redis = require('../config/redis');

// ─────────────────────────────────────────────────────────────────────────────
//  METRICS DASHBOARD ROUTES
//  GET /api/metrics/dispatch  - Dispatch & search pipeline stats
//  GET /api/metrics/ml        - ML health & prediction performance
//  GET /api/metrics/workers   - Worker availability & response analytics
//  GET /api/metrics/system    - Full system overview (aggregated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/metrics/dispatch
 * Returns dispatch pipeline statistics from search_analytics_logs and event_logs
 */
router.get('/dispatch', async (req, res) => {
    try {
        const [
            avgDispatchRes,
            successRateRes,
            stageDistRes,
            recentFailedRes,
            topCategoryRes
        ] = await Promise.all([
            // Average dispatch time, workers found/ranked/notified
            db.query(`
                SELECT
                    ROUND(AVG(dispatch_time_seconds)::numeric, 1) AS avg_dispatch_time_sec,
                    ROUND(AVG(workers_found)::numeric, 1)         AS avg_workers_found,
                    ROUND(AVG(workers_ranked)::numeric, 1)        AS avg_workers_ranked,
                    ROUND(AVG(notifications_sent)::numeric, 1)    AS avg_notifications_sent,
                    ROUND(AVG(expansion_count)::numeric, 1)       AS avg_expansion_stages,
                    ROUND(AVG(initial_radius_km)::numeric, 1)     AS avg_initial_radius_km,
                    COUNT(*)                                       AS total_dispatches
                FROM search_analytics_logs
                WHERE created_at >= NOW() - INTERVAL '24 hours'
            `),
            // Acceptance vs failure rates
            db.query(`
                SELECT
                    COUNT(*) FILTER (WHERE is_completed = true)                       AS completed,
                    COUNT(*) FILTER (WHERE is_completed = false OR is_completed IS NULL) AS pending_or_failed,
                    ROUND(
                        (COUNT(*) FILTER (WHERE is_completed = true)::numeric /
                         NULLIF(COUNT(*)::numeric, 0)) * 100, 1
                    ) AS completion_rate_pct
                FROM search_analytics_logs
                WHERE created_at >= NOW() - INTERVAL '24 hours'
            `),
            // Stage expansion distribution
            db.query(`
                SELECT expansion_count, COUNT(*) AS count
                FROM search_analytics_logs
                WHERE created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY expansion_count
                ORDER BY expansion_count ASC
            `),
            // Recent failed dispatches (failed_no_worker events)
            db.query(`
                SELECT el.job_id, el.metadata, el.created_at,
                       j.category, j.location_lat, j.location_lng
                FROM event_logs el
                LEFT JOIN jobs j ON el.job_id = j.id
                WHERE el.event_type = 'failed_no_worker'
                  AND el.created_at >= NOW() - INTERVAL '6 hours'
                ORDER BY el.created_at DESC
                LIMIT 10
            `),
            // Top categories with highest failure rate
            db.query(`
                SELECT j.category,
                       COUNT(*) AS dispatches,
                       COUNT(*) FILTER (WHERE sal.is_completed = true) AS completed,
                       ROUND(
                           COUNT(*) FILTER (WHERE sal.is_completed = true)::numeric /
                           NULLIF(COUNT(*)::numeric, 0) * 100, 1
                       ) AS completion_rate_pct
                FROM search_analytics_logs sal
                JOIN jobs j ON sal.job_id = j.id
                WHERE sal.created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY j.category
                ORDER BY dispatches DESC
                LIMIT 10
            `)
        ]);

        const avg = avgDispatchRes.rows[0];
        const rates = successRateRes.rows[0];

        res.json({
            success: true,
            period: '24h',
            dispatch: {
                totalDispatches: parseInt(avg.total_dispatches || 0),
                avgDispatchTimeSec: parseFloat(avg.avg_dispatch_time_sec || 0),
                avgWorkersFound: parseFloat(avg.avg_workers_found || 0),
                avgWorkersRanked: parseFloat(avg.avg_workers_ranked || 0),
                avgNotificationsSent: parseFloat(avg.avg_notifications_sent || 0),
                avgExpansionStages: parseFloat(avg.avg_expansion_stages || 0),
                avgInitialRadiusKm: parseFloat(avg.avg_initial_radius_km || 0),
            },
            acceptance: {
                completed: parseInt(rates.completed || 0),
                pendingOrFailed: parseInt(rates.pending_or_failed || 0),
                completionRatePct: parseFloat(rates.completion_rate_pct || 0),
            },
            stageDistribution: stageDistRes.rows.map(r => ({
                stage: parseInt(r.expansion_count),
                count: parseInt(r.count)
            })),
            recentFailures: recentFailedRes.rows,
            categoryBreakdown: topCategoryRes.rows
        });
    } catch (err) {
        console.error('[METRICS-DISPATCH-ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/metrics/ml
 * Returns ML health state, latency stats, and prediction performance
 */
router.get('/ml', async (req, res) => {
    try {
        const mlHealth = require('../services/ml_health.service');
        const status = mlHealth.getStatus();

        const [predCountRes, avgLatencyRes] = await Promise.all([
            db.query(`
                SELECT COUNT(*) AS total_predictions,
                       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') AS predictions_last_hour
                FROM ml_model_monitoring
                WHERE created_at >= NOW() - INTERVAL '24 hours'
            `),
            db.query(`
                SELECT model_name, ROUND(AVG(latency_ms)::numeric, 1) AS avg_latency_ms
                FROM ml_model_monitoring
                WHERE created_at >= NOW() - INTERVAL '1 hour'
                GROUP BY model_name
            `)
        ]);

        res.json({
            success: true,
            ml: {
                state: status.state,
                lastCheck: status.lastCheck,
                consecutiveFailures: status.consecutiveFailures,
                latencyStats: status.latencyStats || {},
                fallbackMode: status.state !== 'ONLINE'
            },
            predictions: {
                total24h: parseInt(predCountRes.rows[0]?.total_predictions || 0),
                lastHour: parseInt(predCountRes.rows[0]?.predictions_last_hour || 0),
                byModel: avgLatencyRes.rows
            }
        });
    } catch (err) {
        console.error('[METRICS-ML-ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/metrics/workers
 * Returns worker availability, acceptance rates, and response analytics
 */
router.get('/workers', async (req, res) => {
    try {
        const [
            onlineRes,
            responseRes,
            topRejectReasonsRes,
            fatigueRes
        ] = await Promise.all([
            // Online / available workers right now
            db.query(`
                SELECT
                    COUNT(*) AS total_workers,
                    COUNT(*) FILTER (WHERE is_online = true) AS online_workers,
                    COUNT(*) FILTER (WHERE is_online = true AND is_available = true) AS available_workers
                FROM workers
            `),
            // Worker response type breakdown (last 24h)
            db.query(`
                SELECT response_type, COUNT(*) AS count
                FROM worker_response_logs
                WHERE created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY response_type
                ORDER BY count DESC
            `),
            // Top rejection reasons
            db.query(`
                SELECT reason, COUNT(*) AS count
                FROM worker_response_logs
                WHERE response_type IN ('DECLINED', 'CANCELLED', 'TIMEOUT')
                  AND reason IS NOT NULL
                  AND created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY reason
                ORDER BY count DESC
                LIMIT 10
            `),
            // High-fatigue workers
            db.query(`
                SELECT w.id, w.full_name, w.phone_number, w.fatigue_score, w.is_online
                FROM workers w
                WHERE w.fatigue_score >= 0.7
                ORDER BY w.fatigue_score DESC
                LIMIT 10
            `)
        ]);

        const online = onlineRes.rows[0];
        const responses = responseRes.rows.reduce((acc, r) => {
            acc[r.response_type] = parseInt(r.count);
            return acc;
        }, {});

        const totalResponses = Object.values(responses).reduce((s, v) => s + v, 0);
        const acceptanceRate = totalResponses > 0
            ? ((responses['ACCEPTED'] || 0) / totalResponses * 100).toFixed(1)
            : '0.0';

        res.json({
            success: true,
            workers: {
                total: parseInt(online.total_workers || 0),
                online: parseInt(online.online_workers || 0),
                available: parseInt(online.available_workers || 0),
            },
            responses: {
                breakdown: responses,
                totalResponses,
                acceptanceRatePct: parseFloat(acceptanceRate),
            },
            topRejectionReasons: topRejectReasonsRes.rows,
            highFatigueWorkers: fatigueRes.rows
        });
    } catch (err) {
        console.error('[METRICS-WORKERS-ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/metrics/system
 * Returns an aggregated system health overview
 */
router.get('/system', async (req, res) => {
    try {
        const [
            jobStatsRes,
            recentEventsRes,
            dispatchSummaryRes
        ] = await Promise.all([
            // Job counts by status (last 24h)
            db.query(`
                SELECT status, COUNT(*) AS count
                FROM jobs
                WHERE created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY status
                ORDER BY count DESC
            `),
            // Last 20 dispatch events
            db.query(`
                SELECT el.event_type, el.created_at,
                       el.metadata->>'latencyFromCreationMs' AS latency_ms,
                       j.category
                FROM event_logs el
                LEFT JOIN jobs j ON el.job_id = j.id
                WHERE el.event_type IN ('dispatch_started','worker_accepted','worker_declined','failed_no_worker','job_completed','worker_cancelled')
                ORDER BY el.created_at DESC
                LIMIT 20
            `),
            // Dispatch pipeline summary last 1h
            db.query(`
                SELECT
                    COUNT(*) AS dispatches,
                    ROUND(AVG(dispatch_time_seconds)::numeric, 1) AS avg_time_sec,
                    ROUND(AVG(workers_found)::numeric, 1) AS avg_workers_found,
                    COUNT(*) FILTER (WHERE is_completed = true) AS succeeded
                FROM search_analytics_logs
                WHERE created_at >= NOW() - INTERVAL '1 hour'
            `)
        ]);

        const jobStats = jobStatsRes.rows.reduce((acc, r) => {
            acc[r.status] = parseInt(r.count);
            return acc;
        }, {});

        const dispatch1h = dispatchSummaryRes.rows[0] || {};

        // ML health state
        let mlState = 'UNKNOWN';
        try {
            const mlHealth = require('../services/ml_health.service');
            mlState = mlHealth.getStatus().state;
        } catch (_) {}

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            jobs24h: jobStats,
            dispatch1h: {
                total: parseInt(dispatch1h.dispatches || 0),
                avgTimeSec: parseFloat(dispatch1h.avg_time_sec || 0),
                avgWorkersFound: parseFloat(dispatch1h.avg_workers_found || 0),
                succeeded: parseInt(dispatch1h.succeeded || 0),
            },
            ml: { state: mlState },
            recentEvents: recentEventsRes.rows
        });
    } catch (err) {
        console.error('[METRICS-SYSTEM-ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
