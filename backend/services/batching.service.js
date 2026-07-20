/**
 * Nexo Batching Compatibility Service — Future-Ready Dispatch Framework
 * 
 * Evaluates whether an additional compatible job can be batched with an already
 * active worker without degrading ETA, capacity, or customer experience.
 */

const db = require('../config/db');
const dispatchConfig = require('../config/dispatch.config');

class BatchingService {
    /**
     * Checks if a worker is eligible to accept an additional batched job.
     */
    async isEligibleForBatching(workerId, newJob) {
        if (!dispatchConfig.batching.enabled) {
            return { eligible: false, reason: "BATCHING_DISABLED" };
        }

        try {
            // Fetch worker's active jobs
            const activeJobsRes = await db.query(
                `SELECT id, location_lat, location_lng, status, category
                 FROM jobs 
                 WHERE worker_id = $1 
                   AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS')`,
                [workerId]
            );

            const activeJobs = activeJobsRes.rows;

            if (activeJobs.length >= dispatchConfig.batching.maxConcurrentJobsPerWorker) {
                return { eligible: false, reason: "MAX_BATCH_CAPACITY_REACHED" };
            }

            if (activeJobs.length === 0) {
                return { eligible: true, reason: "NO_ACTIVE_JOBS" };
            }

            // Route Overlap & Spatial Distance Check
            const primaryJob = activeJobs[0];
            const executionService = require('./execution.service');

            const distBetweenJobsKm = executionService.calculateDistance(
                parseFloat(primaryJob.location_lat),
                parseFloat(primaryJob.location_lng),
                parseFloat(newJob.location_lat),
                parseFloat(newJob.location_lng)
            );

            if (distBetweenJobsKm > dispatchConfig.batching.maxRouteDeviationKm) {
                return { eligible: false, reason: "ROUTE_DEVIATION_TOO_HIGH", deviationKm: distBetweenJobsKm };
            }

            // Category Compatibility Check
            if (primaryJob.category !== newJob.category) {
                return { eligible: false, reason: "CATEGORY_MISMATCH" };
            }

            return { eligible: true, score: 1.0 - (distBetweenJobsKm / dispatchConfig.batching.maxRouteDeviationKm) };
        } catch (e) {
            console.error('[BATCHING-CHECK-ERROR]', e.message);
            return { eligible: false, reason: "INTERNAL_ERROR" };
        }
    }
}

module.exports = new BatchingService();
