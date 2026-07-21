const db = require('../config/db');
const redis = require('../config/redis');
const config = require('../config/marketplace.config');
const { getIO } = require('../config/socket');

class MarketplaceIntelligenceService {
    /**
     * Start background telemetry monitoring loops.
     */
    start() {
        console.log("🚀 [MARKETPLACE-INTELLIGENCE] Starting telemetry background engine...");
        
        // SLA monitoring loop
        this.slaInterval = setInterval(async () => {
            try {
                await this.monitorSlaAndIntervene();
            } catch (err) {
                console.error("⚠️ [MARKETPLACE-SLA-MONITOR] Loop error:", err.message);
            }
        }, config.earlyIntervention.checkIntervalMs);

        // Health monitoring & forecasting loop (every 60s)
        this.healthInterval = setInterval(async () => {
            try {
                await this.runGlobalMarketplaceScan();
            } catch (err) {
                console.error("⚠️ [MARKETPLACE-HEALTH-SCAN] Scan error:", err.message);
            }
        }, 60000);
    }

    stop() {
        if (this.slaInterval) clearInterval(this.slaInterval);
        if (this.healthInterval) clearInterval(this.healthInterval);
    }

    /**
     * Scan all configured marketplace zones, compute health, recommend incentives, and forecast.
     */
    async runGlobalMarketplaceScan() {
        const zonesRes = await db.query("SELECT * FROM marketplace_zones");
        const scanResults = [];

        for (const zone of zonesRes.rows) {
            try {
                const metrics = await this.calculateZoneMetrics(zone);
                const health = this.calculateZoneHealth(metrics);
                const forecasts = await this.forecastSupplyAndDemand(zone);
                
                // Cache metrics and health in Redis
                const redisPayload = {
                    zoneId: zone.id,
                    city: zone.city,
                    zone_name: zone.zone_name,
                    locality: zone.locality,
                    metrics,
                    health,
                    forecasts,
                    updatedAt: new Date().toISOString()
                };

                await redis.set(`marketplace:zone:${zone.id}:metrics`, JSON.stringify(redisPayload), 'EX', 300);
                
                // Auto Incentives recommendation
                await this.autoRecommendIncentives(zone, metrics, health);

                await redis.set(`marketplace:zone:${zone.id}:forecasts`, JSON.stringify(forecasts), 'EX', 600);

                scanResults.push(redisPayload);
            } catch (zoneErr) {
                console.error(`⚠️ [MARKETPLACE-SCAN] Error scanning zone ${zone.locality}:`, zoneErr.message);
            }
        }

        // Broadcast global update to dashboard channels
        const io = getIO();
        if (io) {
            io.to('admin:marketplace_dashboard').emit('marketplace_scan_update', scanResults);
        }

        return scanResults;
    }

    /**
     * Calculates live KPIs for a specific zone.
     */
    async calculateZoneMetrics(zone) {
        const centerLat = parseFloat(zone.center_lat);
        const centerLng = parseFloat(zone.center_lng);
        const radiusKm = parseFloat(zone.radius_km || 5.0);
        const areaSqKm = Math.PI * Math.pow(radiusKm, 2);

        // 1. Current Supply (Online & Available workers within radius)
        const supplyRes = await db.query(`
            SELECT 
                COUNT(*) as online,
                COUNT(*) FILTER (WHERE is_available = true) as available
            FROM workers
            WHERE is_online = true AND location_cube IS NOT NULL
              AND earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 <= $3
        `, [centerLat, centerLng, radiusKm]);

        const currentSupply = parseInt(supplyRes.rows[0]?.available || 0, 10);
        const onlineWorkers = parseInt(supplyRes.rows[0]?.online || 0, 10);

        // 2. Job states count in last 1 hour
        const jobsRes = await db.query(`
            SELECT 
                status, 
                category,
                price,
                earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 as distance
            FROM jobs
            WHERE created_at >= NOW() - INTERVAL '1 hour'
              AND location_cube IS NOT NULL
              AND earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 <= $3
        `, [centerLat, centerLng, radiusKm]);

        let demandCount = 0;
        let activeCount = 0;
        let pendingCount = 0;
        let queuedCount = 0;
        let emergencyCount = 0;
        let categoryCounts = {};

        jobsRes.rows.forEach(job => {
            demandCount++;
            
            // Category count tracking
            categoryCounts[job.category] = (categoryCounts[job.category] || 0) + 1;

            if (job.status === 'QUEUED') {
                queuedCount++;
                pendingCount++;
            } else if (job.status === 'DISPATCHING') {
                pendingCount++;
            } else if (['WORKER_ASSIGNED', 'WORKER_CONFIRMED', 'WORKER_EN_ROUTE', 'WORKER_ARRIVED', 'SERVICE_STARTED', 'SERVICE_IN_PROGRESS', 'SERVICE_PAUSED', 'SERVICE_RESUMED'].includes(job.status)) {
                activeCount++;
            }
        });

        // 3. Telemetry averages from Search Analytics logs (last 24 hours)
        const analyticsRes = await db.query(`
            SELECT 
                AVG(sal.dispatch_time_seconds) as avg_acceptance_time,
                AVG(sal.average_eta_minutes) as avg_eta,
                AVG(sal.initial_radius_km) as avg_dispatch_radius,
                COUNT(*) FILTER (WHERE sal.is_cancelled = true) as cancelled_count,
                COUNT(*) FILTER (WHERE sal.is_completed = true) as completed_count
            FROM search_analytics_logs sal
            JOIN jobs j ON sal.job_id = j.id
            WHERE sal.created_at >= NOW() - INTERVAL '24 hours'
              AND j.location_cube IS NOT NULL
              AND earth_distance(ll_to_earth($1, $2), j.location_cube) / 1000.0 <= $3
        `, [centerLat, centerLng, radiusKm]);

        const analytics = analyticsRes.rows[0] || {};
        
        // 4. Emergency Dispatches count (last 24 hours)
        const emergencyRes = await db.query(`
            SELECT COUNT(*) as count 
            FROM jobs
            WHERE urgency = 'emergency' AND created_at >= NOW() - INTERVAL '24 hours'
              AND location_cube IS NOT NULL
              AND earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 <= $3
        `, [centerLat, centerLng, radiusKm]);
        emergencyCount = parseInt(emergencyRes.rows[0]?.count || 0, 10);

        // 5. Cancelled Jobs & No Shows in last 24h
        const cancelledCount = parseInt(analytics.cancelled_count || 0, 10);
        const completionCount = parseInt(analytics.completed_count || 0, 10);
        const cancellationRate = (cancelledCount + completionCount) > 0 
            ? (cancelledCount / (cancelledCount + completionCount)) * 100 
            : 0;

        // Ratings average for worker and user
        const ratingRes = await db.query(`
            SELECT 
                AVG(rating) FILTER (WHERE rating_type = 'WORKER') as avg_worker_rating,
                AVG(rating) FILTER (WHERE rating_type = 'USER') as avg_customer_rating
            FROM ratings r
            JOIN jobs j ON r.job_id = j.id
            WHERE r.created_at >= NOW() - INTERVAL '7 days'
              AND j.location_cube IS NOT NULL
              AND earth_distance(ll_to_earth($1, $2), j.location_cube) / 1000.0 <= $3
        `, [centerLat, centerLng, radiusKm]);

        // SLA Met Rate (last 24h)
        const slaRes = await db.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE js.status = 'MET') as met
            FROM job_slas js
            JOIN jobs j ON js.job_id = j.id
            WHERE js.created_at >= NOW() - INTERVAL '24 hours'
              AND j.location_cube IS NOT NULL
              AND earth_distance(ll_to_earth($1, $2), j.location_cube) / 1000.0 <= $3
        `, [centerLat, centerLng, radiusKm]);
        
        const totalSla = parseInt(slaRes.rows[0]?.total || 0, 10);
        const metSla = parseInt(slaRes.rows[0]?.met || 0, 10);
        const slaMetRate = totalSla > 0 ? (metSla / totalSla) * 100 : 100.0;

        return {
            currentDemand: demandCount,
            currentSupply,
            onlineWorkers,
            activeJobs: activeCount,
            pendingJobs: pendingCount,
            queuedJobs: queuedCount,
            avgEta: parseFloat(analytics.avg_eta || 15.0),
            avgWaitingMins: parseFloat(analytics.avg_acceptance_time || 120) / 60.0,
            avgAcceptanceTimeSec: parseFloat(analytics.avg_acceptance_time || 45.0),
            avgCompletionTimeMins: 45.0, // default placeholder
            workerAvailability: onlineWorkers > 0 ? (currentSupply / onlineWorkers) * 100 : 100.0,
            workerDensity: onlineWorkers / areaSqKm,
            customerDensity: demandCount / areaSqKm,
            peakHours: [10, 11, 17, 18, 19], // default peak hours
            cancelledJobs: cancelledCount,
            noShows: Math.round(cancelledCount * 0.1), // approximate
            emergencyDispatches: emergencyCount,
            avgDispatchRadius: parseFloat(analytics.avg_dispatch_radius || 3.0),
            avgQueueDepth: queuedCount,
            avgPoolSuccessRate: 85.0,
            cancellationRate,
            avgWorkerRating: parseFloat(ratingRes.rows[0]?.avg_worker_rating || 4.5),
            avgCustomerRating: parseFloat(ratingRes.rows[0]?.avg_customer_rating || 4.7),
            slaMetRate
        };
    }

    /**
     * Determines zone health score and classification.
     */
    calculateZoneHealth(metrics) {
        let score = 100;

        // 1. Supply-Demand ratio constraint
        const supplyDemandRatio = metrics.currentSupply / Math.max(metrics.currentDemand, 1);
        if (supplyDemandRatio < 0.5) score -= 25;
        else if (supplyDemandRatio < 1.0) score -= 15;

        // 2. Average ETA penalties
        if (metrics.avgEta > 30) score -= 20;
        else if (metrics.avgEta > 20) score -= 10;

        // 3. SLA Success penalties
        if (metrics.slaMetRate < 85) score -= 20;
        else if (metrics.slaMetRate < 95) score -= 10;

        // 4. Acceptance speed
        if (metrics.avgAcceptanceTimeSec > 120) score -= 15;
        else if (metrics.avgAcceptanceTimeSec > 60) score -= 5;

        // 5. Cancellations
        if (metrics.cancellationRate > 20) score -= 10;
        else if (metrics.cancellationRate > 10) score -= 5;

        // 6. Ratings
        if (metrics.avgWorkerRating < 4.2) score -= 10;

        // Categorize based on score
        let classification = 'Excellent';
        if (score < config.health.thresholds.warning) {
            classification = 'Critical';
        } else if (score < config.health.thresholds.healthy) {
            classification = 'Warning';
        } else if (score < config.health.thresholds.excellent) {
            classification = 'Healthy';
        }

        return { score, classification };
    }

    /**
     * Predictive Supply and Demand Forecast Engine.
     */
    async forecastSupplyAndDemand(zone) {
        const hour = new Date().getHours();
        const dayOfWeek = new Date().getDay();
        const date = new Date().getDate();

        // Simulated Weather status check (dynamic Redis lookup or defaults)
        const weather = (await redis.get('marketplace:weather')) || 'SUNNY';
        const weatherMult = config.forecast.multipliers.weather[weather] || { indoor: 1.0, outdoor: 1.0, supply: 1.0 };
        
        const isWeekend = [0, 6].includes(dayOfWeek);
        const isSalaryDay = date >= 1 && date <= 5;

        // Heuristics baseline weights for different future offsets
        const offsets = [
            { label: '30m', multiplier: 0.9 },
            { label: '1h', multiplier: 1.0 },
            { label: '3h', multiplier: 1.2 },
            { label: '6h', multiplier: 1.4 },
            { label: '12h', multiplier: 0.8 },
            { label: '24h', multiplier: 1.0 }
        ];

        // Fetch past historical demand count in this zone
        const histRes = await db.query(`
            SELECT COUNT(*) as count 
            FROM jobs 
            WHERE created_at >= NOW() - INTERVAL '7 days'
              AND location_cube IS NOT NULL
              AND earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 <= $3
        `, [zone.center_lat, zone.center_lng, zone.radius_km]);
        const baselineDemand = Math.max(1, Math.round(parseInt(histRes.rows[0]?.count || 0, 10) / 168)); // hourly avg

        // Fetch past historical online workers in this zone
        const baselineWorkers = Math.max(3, zone.radius_km * 2);

        const projections = {};
        offsets.forEach(offset => {
            let demandMultiplier = offset.multiplier;
            let supplyMultiplier = offset.multiplier;

            // Apply weather adjustments
            demandMultiplier *= weatherMult.indoor;
            supplyMultiplier *= weatherMult.supply;

            // Weekend patterns
            if (isWeekend) {
                demandMultiplier *= config.forecast.multipliers.weekend.demand;
                supplyMultiplier *= config.forecast.multipliers.weekend.supply;
            }

            // Salary days uplift
            if (isSalaryDay) {
                demandMultiplier *= config.forecast.multipliers.weekend.demand;
            }

            // High/low hours variations
            if (hour >= 22 || hour < 6) { // night
                demandMultiplier *= 0.3;
                supplyMultiplier *= 0.2;
            }

            projections[offset.label] = {
                predictedDemand: Math.round(baselineDemand * demandMultiplier),
                predictedSupply: Math.round(baselineWorkers * supplyMultiplier)
            };
        });

        return projections;
    }

    /**
     * Suggest Incentive Adjustments based on supply-demand constraints.
     */
    async autoRecommendIncentives(zone, metrics, health) {
        // Recommend if health is Warning/Critical or supply is insufficient
        const isLowSupply = metrics.currentSupply < metrics.currentDemand;
        const isStrained = ['Warning', 'Critical'].includes(health.classification);

        if (!isLowSupply && !isStrained) return;

        let incentiveType = 'AREA_BONUS';
        let value = 50.0; // currency units default
        let reason = `Supply crunch detected in ${zone.locality}. Supply: ${metrics.currentSupply}, Demand: ${metrics.currentDemand}.`;

        if (metrics.emergencyDispatches > 2) {
            incentiveType = 'URGENT_BONUS';
            value = 100.0;
            reason += ` Excess emergency dispatches: ${metrics.emergencyDispatches}.`;
        } else if (metrics.avgEta > 25) {
            incentiveType = 'PEAK_BONUS';
            value = 75.0;
            reason += ` Critical ETA inflation: ${metrics.avgEta.toFixed(1)} mins.`;
        }

        // Check if recommendation was already generated in the last 15 minutes to avoid spamming
        const existRes = await db.query(`
            SELECT 1 FROM incentive_recommendations
            WHERE zone_id = $1 AND incentive_type = $2 AND status = 'PENDING_APPROVAL'
              AND created_at >= NOW() - INTERVAL '15 minutes'
            LIMIT 1
        `, [zone.id, incentiveType]);

        if (existRes.rowCount > 0) return;

        await db.query(`
            INSERT INTO incentive_recommendations (zone_id, incentive_type, recommended_value, reason)
            VALUES ($1, $2, $3, $4)
        `, [zone.id, incentiveType, value, reason]);

        console.log(`💡 [INCENTIVE-ENGINE] Generated ${incentiveType} recommendation for zone ${zone.locality}`);
    }

    /**
     * SLA Monitor: Evaluates assignment and arrival timings, predicting failures.
     */
    async monitorSlaAndIntervene() {
        // Find active jobs that don't have SLA met status yet
        const activeSlas = await db.query(`
            SELECT js.*, j.status, j.category, j.location_lat, j.location_lng, j.created_at as job_created_at
            FROM job_slas js
            JOIN jobs j ON js.job_id = j.id
            WHERE js.status = 'ACTIVE'
        `);

        for (const sla of activeSlas.rows) {
            let predictedFailure = false;
            let failureReason = '';

            const now = new Date();
            const createdTime = new Date(sla.job_created_at);
            const elapsedMs = now - createdTime;

            const limits = config.slas[sla.sla_type] || config.slas.NORMAL;

            // Case A: Job is not assigned yet and approaching assignment deadline
            if (['BOOKED', 'VALIDATED', 'QUEUED', 'DISPATCHING'].includes(sla.status)) {
                const warnBuffer = sla.sla_type === 'EMERGENCY' 
                    ? config.earlyIntervention.emergencyAssignmentBufferMs 
                    : config.earlyIntervention.normalAssignmentBufferMs;

                const remainingAssignMs = limits.assignmentLimitMs - elapsedMs;

                if (remainingAssignMs <= warnBuffer && remainingAssignMs > 0) {
                    predictedFailure = true;
                    failureReason = 'ASSIGNMENT_DEADLINE_APPROACHING';
                } else if (remainingAssignMs <= 0) {
                    // Breach occurred
                    await db.query("UPDATE job_slas SET status = 'FAILED', updated_at = NOW() WHERE job_id = $1", [sla.job_id]);
                    continue;
                }
            }

            // Case B: Worker assigned but destination ETA is greater than remaining time to arrival deadline
            if (['WORKER_ASSIGNED', 'WORKER_CONFIRMED', 'WORKER_EN_ROUTE'].includes(sla.status)) {
                const arrivalDeadline = new Date(sla.arrival_deadline);
                const remainingArrivalMs = arrivalDeadline - now;

                // Query worker's cached ETA if available in Redis
                const cachedEta = await redis.get(`job:${sla.job_id}:last_directions_time`);
                const cachedDurationSec = await redis.get(`job:${sla.job_id}:last_directions_duration`);
                const etaMs = cachedDurationSec ? parseInt(cachedDurationSec, 10) * 1000 : 15 * 60 * 1000; // default 15m

                if (etaMs > remainingArrivalMs) {
                    predictedFailure = true;
                    failureReason = 'ARRIVAL_ETA_BREACH_PREDICTED';
                }
            }

            if (predictedFailure) {
                console.warn(`🚨 [SLA-ENGINE] Predicted SLA breach on job ${sla.job_id}. Reason: ${failureReason}. Triggering early intervention...`);
                
                await db.query(`
                    UPDATE job_slas 
                    SET status = 'PREDICTED_FAILURE', predicted_failure_reason = $1, updated_at = NOW()
                    WHERE job_id = $2
                `, [failureReason, sla.job_id]);

                // Run Early Intervention recovery tasks
                await this.triggerEarlyIntervention(sla, failureReason);
            }
        }
    }

    /**
     * Executes Early Intervention steps to recover failing dispatches.
     */
    async triggerEarlyIntervention(sla, reason) {
        const jobId = sla.job_id;

        // 1. Expand search radius in DB and trigger redispatch
        await db.query(`
            UPDATE jobs 
            SET search_radius_km = COALESCE(search_radius_km, 5.0) + $1, 
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2
        `, [config.earlyIntervention.radiusExpansionKm, jobId]);

        // 2. Set redis search flag to wake up dispatching queue
        await redis.set(`job:${jobId}:searching`, '1');
        await redis.incr(`job:${jobId}:queue_refresh_count`);

        // 3. If standby backup is available, activate immediately
        try {
            const backupWorkerService = require('./backup_worker.service');
            const activation = await backupWorkerService.checkAndActivateBackup(jobId, reason);
            if (activation && activation.success) {
                await redis.set(`job:${jobId}:standby_used`, 'true');
                console.log(`✅ [SLA-INTERVENTION] Backup worker successfully activated for job ${jobId}`);
            }
        } catch (backupErr) {
            console.error(`⚠️ [SLA-INTERVENTION] Failed backup activation:`, backupErr.message);
        }

        // 4. Recommend urgent pricing bonus adjustments
        try {
            const zoneRes = await db.query(`
                SELECT id FROM marketplace_zones 
                ORDER BY earth_distance(ll_to_earth(center_lat, center_lng), ll_to_earth($1, $2)) ASC 
                LIMIT 1
            `, [parseFloat(sla.location_lat), parseFloat(sla.location_lng)]);

            if (zoneRes.rowCount > 0) {
                const zoneId = zoneRes.rows[0].id;
                await db.query(`
                    INSERT INTO incentive_recommendations (zone_id, incentive_type, recommended_value, reason)
                    VALUES ($1, 'URGENT_BONUS', 120.0, 'Automated early intervention suggestion due to SLA threat on job ' || $2)
                `, [zoneId, jobId]);
            }
        } catch (incErr) {
            // non-critical
        }

        // 5. Escalate alert to dashboard users via socket.io
        const io = getIO();
        if (io) {
            io.to('admin:marketplace_dashboard').emit('SLA_ESCALATION_ALERT', {
                jobId,
                slaType: sla.sla_type,
                reason,
                message: `Immediate escalation required for job ${jobId}. Search radius expanded, backup workers triggered.`
            });
        }
    }

    /**
     * Load Balancer: Injects balancing penalties and bonuses directly into ranking score.
     */
    async applyLoadBalancing(workerId, rawScore) {
        try {
            // Fetch worker earnings in last 24h and 7 days
            const earningsRes = await db.query(`
                SELECT 
                    COALESCE(SUM(price) FILTER (WHERE completed_at >= NOW() - INTERVAL '24 hours'), 0) as daily_earnings,
                    COALESCE(SUM(price) FILTER (WHERE completed_at >= NOW() - INTERVAL '7 days'), 0) as weekly_earnings
                FROM jobs
                WHERE worker_id = $1 AND status = 'COMPLETED'
            `, [workerId]);

            const dailyEarnings = parseFloat(earningsRes.rows[0]?.daily_earnings || 0);
            const weeklyEarnings = parseFloat(earningsRes.rows[0]?.weekly_earnings || 0);

            // Fetch idle time since last completed job
            const idleRes = await db.query(`
                SELECT COALESCE(
                    EXTRACT(EPOCH FROM (NOW() - MAX(completed_at))),
                    86400
                ) as idle_time_seconds
                FROM jobs
                WHERE worker_id = $1 AND status = 'COMPLETED'
            `, [workerId]);

            const idleSeconds = parseFloat(idleRes.rows[0]?.idle_time_seconds || 86400);
            const idleMins = idleSeconds / 60.0;

            // Compute load penalties
            const dailyPenalty = Math.min(
                config.loadBalancer.maxDailyPenalty,
                (dailyEarnings / config.loadBalancer.dailyEarningsLimit) * config.loadBalancer.maxDailyPenalty
            );

            const weeklyPenalty = Math.min(
                config.loadBalancer.maxWeeklyPenalty,
                (weeklyEarnings / config.loadBalancer.weeklyEarningsLimit) * config.loadBalancer.maxWeeklyPenalty
            );

            // Compute idle time reward
            const idleBonus = Math.min(
                config.loadBalancer.maxIdleBonus,
                (idleMins / config.loadBalancer.idleTimeTargetMins) * config.loadBalancer.maxIdleBonus
            );

            const balancedScore = Math.max(0.0, Math.min(1.0, rawScore - dailyPenalty - weeklyPenalty + idleBonus));

            return {
                balancedScore,
                breakdown: {
                    rawScore,
                    dailyEarnings,
                    weeklyEarnings,
                    idleMins,
                    dailyPenalty,
                    weeklyPenalty,
                    idleBonus
                }
            };
        } catch (err) {
            console.error(`⚠️ [LOAD-BALANCER] Scoring failed for worker ${workerId}:`, err.message);
            return { balancedScore: rawScore, breakdown: { rawScore } };
        }
    }

    /**
     * Hotspot Detection: Pinpoints locations with high cancellations or high wait times.
     */
    async detectHotspots() {
        // Find hotspots based on repeated cancellations or wait times in last 6 hours
        const cancellationsHotspots = await db.query(`
            SELECT 
                ROUND(location_lat, 3) as lat, 
                ROUND(location_lng, 3) as lng,
                COUNT(*) as cancellation_count
            FROM jobs
            WHERE status = 'CANCELLED' AND cancelled_at >= NOW() - INTERVAL '6 hours'
            GROUP BY ROUND(location_lat, 3), ROUND(location_lng, 3)
            HAVING COUNT(*) >= 2
            ORDER BY cancellation_count DESC
            LIMIT 10
        `);

        return cancellationsHotspots.rows.map(row => ({
            latitude: parseFloat(row.lat),
            longitude: parseFloat(row.lng),
            weight: parseInt(row.cancellation_count, 10),
            type: 'HIGH_CANCELLATION'
        }));
    }
}

module.exports = new MarketplaceIntelligenceService();
