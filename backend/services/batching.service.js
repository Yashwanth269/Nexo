/**
 * Nexo Batching Compatibility Service — Production Dispatch Framework
 * 
 * Evaluates whether an additional compatible job can be batched with an already
 * active worker without degrading ETA, capacity, or customer experience.
 */

const db = require('../config/db');
const redis = require('../config/redis');
const batchingConfig = require('../config/batching.config');

const STATUS_PRIORITY = {
    'WORK_IN_PROGRESS': 1,
    'STARTED': 1,
    'ARRIVED': 2,
    'FORCE_ARRIVAL_PENDING_CONFIRMATION': 2,
    'ON_THE_WAY': 3,
    'ACCEPTED': 4,
    'READY_TO_START': 4,
    'RESERVED': 5,
    'SCHEDULED': 6
};

function getStatusPriority(status) {
    return STATUS_PRIORITY[status] || 99;
}

async function logBatchingDecision(workerId, jobId, eligible, reason, metadata = {}) {
    try {
        await db.query(`
            INSERT INTO event_logs (job_id, worker_id, event_type, metadata)
            VALUES ($1, $2, $3, $4)
        `, [
            jobId, 
            workerId, 
            eligible ? 'batching_eligible' : 'batching_ineligible',
            JSON.stringify({ reason, metadata, timestamp: new Date().toISOString() })
        ]);
        console.log(`[BATCHING] Decision logged for Job ${jobId}, Worker ${workerId}: Eligible? ${eligible}, Reason: ${reason}`);
    } catch (logErr) {
        console.error("Failed to write batching event log:", logErr.message);
    }
}

class BatchingService {
    /**
     * Checks if a worker is eligible to accept an additional batched job.
     */
    async isEligibleForBatching(workerId, newJob) {
        if (!batchingConfig.enabled) {
            return { eligible: false, reason: "BATCHING_DISABLED" };
        }

        // 1. Missing Job Constraints
        if (batchingConfig.exclusiveCategories.includes(newJob.category) || newJob.scheduled_at !== null) {
            return { eligible: false, reason: "JOB_EXCLUDED_FROM_BATCHING" };
        }

        // 2. Protect from Race Conditions using a Redis distributed lock
        const lockKey = `lock:batching:${workerId}`;
        const acquiredLock = await redis.set(lockKey, '1', 'NX', 'EX', 5);
        if (!acquiredLock) {
            return { eligible: false, reason: "CONCURRENT_BATCHING_LOCK" };
        }

        try {
            // 3. Missing Worker State Checks
            const workerRes = await db.query(
                `SELECT is_online, is_available, verification_status 
                 FROM workers WHERE id = $1`,
                [workerId]
            );
            if (workerRes.rowCount === 0) {
                return { eligible: false, reason: "WORKER_NOT_FOUND" };
            }
            const worker = workerRes.rows[0];

            if (!worker.is_online || !worker.is_available) {
                await logBatchingDecision(workerId, newJob.id, false, "WORKER_OFFLINE_OR_UNAVAILABLE");
                return { eligible: false, reason: "WORKER_OFFLINE_OR_UNAVAILABLE" };
            }
            if (worker.verification_status !== 'VERIFIED') {
                await logBatchingDecision(workerId, newJob.id, false, "WORKER_UNVERIFIED");
                return { eligible: false, reason: "WORKER_UNVERIFIED" };
            }

            // Fetch fatigue score
            const fatigueRes = await db.query(
                `SELECT fatigue_score, composite_fatigue_score FROM advanced_fatigue_scores WHERE worker_id = $1`,
                [workerId]
            );
            const workerFatigue = fatigueRes.rowCount > 0 
                ? parseFloat(fatigueRes.rows[0].fatigue_score || fatigueRes.rows[0].composite_fatigue_score || 0)
                : 0.0;

            // GPS Freshness verification
            const lastSeen = await redis.get(`worker:${workerId}:last_seen`);
            if (!lastSeen || (Date.now() - parseInt(lastSeen, 10)) > batchingConfig.gpsFreshnessThresholdMs) {
                await logBatchingDecision(workerId, newJob.id, false, "GPS_STALE");
                return { eligible: false, reason: "GPS_STALE" };
            }

            // Shadow ban verification
            const shadowBanRes = await db.query(
                "SELECT active FROM shadow_ban_status WHERE worker_id = $1 AND active = TRUE",
                [workerId]
            );
            if (shadowBanRes.rowCount > 0) {
                await logBatchingDecision(workerId, newJob.id, false, "WORKER_SHADOW_BANNED");
                return { eligible: false, reason: "WORKER_SHADOW_BANNED" };
            }

            // 4. Fetch worker's active jobs using Database caching to reduce load
            const activeJobsCacheKey = `worker:${workerId}:active_jobs`;
            let activeJobs;
            const cachedJobs = await redis.get(activeJobsCacheKey);
            if (cachedJobs) {
                activeJobs = JSON.parse(cachedJobs);
            } else {
                const activeJobsRes = await db.query(
                    `SELECT id, location_lat, location_lng, status, category, scheduled_at, price 
                     FROM jobs 
                     WHERE worker_id = $1 
                       AND status = ANY($2)`,
                    [workerId, batchingConfig.activeStatuses]
                );
                activeJobs = activeJobsRes.rows;
                await redis.set(activeJobsCacheKey, JSON.stringify(activeJobs), 'EX', batchingConfig.redisCacheTtlSeconds);
            }

            if (activeJobs.length >= batchingConfig.maxConcurrentJobsPerWorker) {
                await logBatchingDecision(workerId, newJob.id, false, "MAX_BATCH_CAPACITY_REACHED");
                return { eligible: false, reason: "MAX_BATCH_CAPACITY_REACHED" };
            }

            if (activeJobs.length === 0) {
                await logBatchingDecision(workerId, newJob.id, true, "NO_ACTIVE_JOBS");
                return { eligible: true, reason: "NO_ACTIVE_JOBS" };
            }

            // 5. Category Compatibility Check (via Compatibility Matrix)
            for (const activeJob of activeJobs) {
                const activeCat = activeJob.category || 'General';
                const compatibleCats = batchingConfig.compatibilityMatrix[activeCat] || [activeCat];
                if (!compatibleCats.includes(newJob.category)) {
                    await logBatchingDecision(workerId, newJob.id, false, "CATEGORY_MISMATCH", { activeCategory: activeCat, newCategory: newJob.category });
                    return { eligible: false, reason: "CATEGORY_MISMATCH" };
                }
            }

            // 6. Primary Job / Reference Job Sort
            const sortedActiveJobs = [...activeJobs].sort((a, b) => getStatusPriority(a.status) - getStatusPriority(b.status));
            const primaryJob = sortedActiveJobs[0];

            // 7. Route and Travel Time Compatibility Check
            let roadDistance = 0;
            let travelDuration = 0;
            let travelCalculated = false;

            try {
                const { getDirections } = require('../utils/google_maps');
                if (primaryJob.location_lat && newJob.location_lat) {
                    const directions = await getDirections(
                        parseFloat(primaryJob.location_lat),
                        parseFloat(primaryJob.location_lng),
                        parseFloat(newJob.location_lat),
                        parseFloat(newJob.location_lng)
                    );
                    roadDistance = directions.distanceMeters / 1000.0;
                    travelDuration = directions.durationSeconds / 60.0;
                    travelCalculated = true;
                }
            } catch (dirErr) {
                console.warn("Failed to retrieve directions, falling back to haversine:", dirErr.message);
            }

            if (!travelCalculated) {
                const executionService = require('./execution.service');
                roadDistance = executionService.calculateDistance(
                    parseFloat(primaryJob.location_lat),
                    parseFloat(primaryJob.location_lng),
                    parseFloat(newJob.location_lat),
                    parseFloat(newJob.location_lng)
                );
                travelDuration = 20 + roadDistance * 2.0; // 20m prep + 2 mins per km
            }

            if (roadDistance > batchingConfig.maxRouteDeviationKm) {
                await logBatchingDecision(workerId, newJob.id, false, "ROUTE_DEVIATION_TOO_HIGH", { deviationKm: roadDistance });
                return { eligible: false, reason: "ROUTE_DEVIATION_TOO_HIGH", deviationKm: roadDistance };
            }

            if (travelDuration > batchingConfig.maxEtaIncreaseMinutes) {
                await logBatchingDecision(workerId, newJob.id, false, "ETA_DELAY_TOO_HIGH", { durationMins: travelDuration });
                return { eligible: false, reason: "ETA_DELAY_TOO_HIGH", durationMins: travelDuration };
            }

            // 8. Calendar Integration Check
            const reservationService = require('./reservation.service');
            const durationMins = await reservationService.predictJobDuration(newJob.category);
            const calendarConflict = await reservationService.checkCalendarConflict(
                workerId,
                newJob.scheduled_at || new Date(),
                durationMins,
                newJob.category,
                parseFloat(newJob.location_lat),
                parseFloat(newJob.location_lng)
            );
            if (calendarConflict.conflict) {
                await logBatchingDecision(workerId, newJob.id, false, `CALENDAR_CONFLICT_${calendarConflict.reason}`);
                return { eligible: false, reason: `CALENDAR_CONFLICT_${calendarConflict.reason}` };
            }

            // 9. Worker Fatigue & Capacity Checks
            if (workerFatigue > batchingConfig.maxFatigueScore) {
                await logBatchingDecision(workerId, newJob.id, false, "WORKER_EXHAUSTED", { fatigueScore: workerFatigue });
                return { eligible: false, reason: "WORKER_EXHAUSTED", fatigueScore: workerFatigue };
            }

            // 10. Traffic Congestion Awareness Check
            let trafficRisk = 'LOW';
            try {
                const intelService = require('./marketplace_intelligence.service');
                const wZone = await db.query(
                    `SELECT locality FROM marketplace_zones
                     ORDER BY (ll_to_earth(center_lat, center_lng) <-> ll_to_earth($1, $2)) ASC
                     LIMIT 1`,
                    [parseFloat(primaryJob.location_lat), parseFloat(primaryJob.location_lng)]
                );
                const jZone = await db.query(
                    `SELECT locality FROM marketplace_zones
                     ORDER BY (ll_to_earth(center_lat, center_lng) <-> ll_to_earth($1, $2)) ASC
                     LIMIT 1`,
                    [parseFloat(newJob.location_lat), parseFloat(newJob.location_lng)]
                );
                if (wZone.rowCount > 0 && jZone.rowCount > 0) {
                    const trafficAnalysis = intelService.predictTrafficRisk(wZone.rows[0].locality, jZone.rows[0].locality);
                    trafficRisk = trafficAnalysis.riskLevel || 'LOW';
                }
            } catch (e) {
                console.warn("Traffic awareness check failed:", e.message);
            }

            // 11. Multi-factor AI Scoring
            const distancePenalty = (roadDistance / batchingConfig.maxRouteDeviationKm) * 40;
            const etaPenalty = (travelDuration / batchingConfig.maxEtaIncreaseMinutes) * 30;
            const trafficPenalty = trafficRisk === 'HIGH' || trafficRisk === 'SEVERE' ? 20 : (trafficRisk === 'MEDIUM' ? 10 : 0);

            const score = Math.max(0.01, Math.min(1.0, 1.0 - (distancePenalty + etaPenalty + trafficPenalty) / 100));

            await logBatchingDecision(workerId, newJob.id, true, "BATCHING_ELIGIBLE", { score, roadDistance, travelDuration, trafficRisk });
            return { eligible: true, score };

        } catch (e) {
            console.error('[BATCHING-CHECK-ERROR]', e.message);
            return { eligible: false, reason: "INTERNAL_ERROR" };
        } finally {
            await redis.del(lockKey);
        }
    }
}

module.exports = new BatchingService();
