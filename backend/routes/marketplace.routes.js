const express = require('express');
const router = express.Router();
const db = require('../config/db');
const redis = require('../config/redis');
const marketplaceIntel = require('../services/marketplace_intelligence.service');

/**
 * GET /api/marketplace/dashboard
 * Aggregated Global Marketplace Dashboard data for telemetry views.
 */
router.get('/dashboard', async (req, res) => {
    try {
        const zonesRes = await db.query("SELECT * FROM marketplace_zones");
        const liveZones = [];
        
        let totalDemand = 0;
        let totalSupply = 0;
        let totalActiveJobs = 0;
        let totalPendingJobs = 0;
        let totalQueuedJobs = 0;
        let totalEmergency = 0;
        let sumEta = 0;
        let sumSlaMet = 0;
        let ratedZonesCount = 0;

        for (const zone of zonesRes.rows) {
            const cached = await redis.get(`marketplace:zone:${zone.id}:metrics`);
            const forecastCached = await redis.get(`marketplace:zone:${zone.id}:forecasts`);
            
            let data;
            if (cached) {
                data = JSON.parse(cached);
            } else {
                // compute live if missing
                const metrics = await marketplaceIntel.calculateZoneMetrics(zone);
                const health = marketplaceIntel.calculateZoneHealth(metrics);
                data = { metrics, health };
            }

            const forecasts = forecastCached ? JSON.parse(forecastCached) : {};

            liveZones.push({
                id: zone.id,
                zone_name: zone.zone_name,
                locality: zone.locality,
                city: zone.city,
                center_lat: parseFloat(zone.center_lat),
                center_lng: parseFloat(zone.center_lng),
                radius_km: parseFloat(zone.radius_km),
                metrics: data.metrics,
                health: data.health,
                forecasts
            });

            totalDemand += data.metrics.currentDemand;
            totalSupply += data.metrics.currentSupply;
            totalActiveJobs += data.metrics.activeJobs;
            totalPendingJobs += data.metrics.pendingJobs;
            totalQueuedJobs += data.metrics.queuedJobs;
            totalEmergency += data.metrics.emergencyDispatches;
            sumEta += data.metrics.avgEta;
            sumSlaMet += data.metrics.slaMetRate;
            ratedZonesCount++;
        }

        // Fetch overall revenue summary (last 30 days)
        const revRes = await db.query(`
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM payments 
            WHERE payment_status = 'COMPLETED' AND created_at >= NOW() - INTERVAL '30 days'
        `);

        // Fetch alerts / hotspots
        const hotspots = await marketplaceIntel.detectHotspots();

        // Query active dispatch queues details
        const activeQueuesRes = await db.query(`
            SELECT id, category, price, status, location_lat, location_lng, search_radius_km, created_at 
            FROM jobs 
            WHERE status IN ('CREATED', 'QUEUED', 'DISPATCHING') 
            ORDER BY created_at DESC 
            LIMIT 15
        `);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            metrics: {
                totalDemand,
                totalSupply,
                totalActiveJobs,
                totalPendingJobs,
                totalQueuedJobs,
                totalEmergency,
                avgEta: ratedZonesCount > 0 ? parseFloat((sumEta / ratedZonesCount).toFixed(1)) : 15.0,
                slaMetRate: ratedZonesCount > 0 ? parseFloat((sumSlaMet / ratedZonesCount).toFixed(1)) : 100.0,
                revenue30d: parseFloat(revRes.rows[0]?.total || 0)
            },
            liveCities: ['Bangalore'],
            liveZones,
            hotspots,
            dispatchQueues: activeQueuesRes.rows,
            demandHeatmap: liveZones.map(z => ({ lat: z.center_lat, lng: z.center_lng, weight: z.metrics.currentDemand })),
            supplyHeatmap: liveZones.map(z => ({ lat: z.center_lat, lng: z.center_lng, weight: z.metrics.currentSupply }))
        });
    } catch (err) {
        console.error('[MARKETPLACE-DASHBOARD-ROUTE-ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/marketplace/incentive-recommendations
 * Fetch pending incentive recommendations requiring approval.
 */
router.get('/incentive-recommendations', async (req, res) => {
    try {
        const recommendations = await db.query(`
            SELECT r.*, z.locality, z.zone_name, z.city 
            FROM incentive_recommendations r
            JOIN marketplace_zones z ON r.zone_id = z.id
            WHERE r.status = 'PENDING_APPROVAL'
            ORDER BY r.created_at DESC
        `);
        res.json({ success: true, recommendations: recommendations.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/marketplace/incentive-recommendations/:id/approve
 * Approve recommended peak/area bonuses.
 */
router.post('/incentive-recommendations/:id/approve', async (req, res) => {
    const { id } = req.params;
    const adminId = req.body.adminId || '00000000-0000-0000-0000-000000000000'; // dummy fallback UUID

    try {
        const checkRes = await db.query("SELECT * FROM incentive_recommendations WHERE id = $1 AND status = 'PENDING_APPROVAL'", [id]);
        if (checkRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Recommendation not found or already processed" });
        }

        const rec = checkRes.rows[0];

        // 1. Mark approved in DB
        await db.query(`
            UPDATE incentive_recommendations 
            SET status = 'APPROVED', approved_by = $1, updated_at = NOW() 
            WHERE id = $2
        `, [adminId, id]);

        // 2. Persist the approved bonus factor in Redis config for active surcharge matching
        const bonusKey = `incentive:bonus:zone:${rec.zone_id}`;
        await redis.set(bonusKey, JSON.stringify({
            type: rec.incentive_type,
            value: parseFloat(rec.recommended_value),
            approvedAt: new Date().toISOString()
        }), 'EX', 7200); // active for 2 hours

        res.json({
            success: true,
            message: `Successfully approved ${rec.incentive_type} of value ${rec.recommended_value} for zone ${rec.zone_id}`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
