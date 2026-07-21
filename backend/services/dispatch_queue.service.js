const db = require('../config/db');
const redis = require('../config/redis');
const dispatchConfig = require('../config/dispatch.config');
const { isSkillMatch } = require('../utils/skill_matcher');
const skillConfidenceService = require('./skill_confidence.service');
const fatigueService = require('./fatigue.service');
const shadowBanService = require('./shadow_ban.service');
const rankingService = require('./ranking.service');
const searchRadiusService = require('./search_radius.service');
const distributedLock = require('./distributed_lock.service');
const reservationService = require('./reservation.service');

class DispatchQueueService {
    /**
     * Entry point to launch or resume dispatch pipeline for a job
     */
    async broadcastJob(jobId) {
        const pipelineLock = `dispatch_pipeline_running:${jobId}`;
        const locked = await redis.set(pipelineLock, '1', 'NX', 'EX', 600);
        if (!locked) {
            console.log(`[DISPATCH] Staged pool matching pipeline already running for Job ${jobId}`);
            return;
        }

        try {
            await this.runDispatchPipeline(jobId);
        } catch (err) {
            console.error(`[DISPATCH-PIPELINE-FATAL] Job ${jobId}:`, err.message);
        } finally {
            await redis.del(pipelineLock);
        }
    }

    /**
     * Classifies a job into one of the 5 logical priority queues
     */
    determineJobQueue(job) {
        if (job.status === 'REASSIGNING' || job.priority === 'Critical') {
            return 'EMERGENCY';
        }
        if (job.priority === 'High' || job.urgency === 'express') {
            return 'HIGH_PRIORITY';
        }
        if (job.scheduled_at) {
            const wasAssigned = job.worker_id !== null || job.status === 'REDISTRIBUTING';
            if (wasAssigned) {
                return 'SCHEDULED_RECOVERY';
            }
            return 'SCHEDULED_FUTURE';
        }
        return 'INSTANT';
    }

    /**
     * Orchestrates the pool-based dispatch lifecycle
     */
    async runDispatchPipeline(jobId) {
        const startMs = Date.now();
        console.log(`🚀 [DISPATCH-PIPELINE] Staged Pool Dispatch started for Job ${jobId}`);

        // 1. Fetch Job info and verify active status
        const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount === 0) return;
        const job = jobRes.rows[0];

        if (!['OPEN', 'REDISTRIBUTING', 'REASSIGNING', 'SCHEDULED', 'BUILD_QUEUE'].includes(job.status)) {
            console.log(`[DISPATCH-TERMINATE] Job ${jobId} status is ${job.status}. Aborting.`);
            return;
        }

        // Determine Priority Queue (Step 25: Multi-Queue Dispatch)
        const queueType = this.determineJobQueue(job);
        console.log(`[DISPATCH-QUEUE-TYPE] Job ${jobId} classified as: ${queueType}`);

        // Check Scheduled dispatch window (Step 25)
        if (queueType === 'SCHEDULED_FUTURE') {
            const start = new Date(job.scheduled_at);
            const timeDiffMin = (start.getTime() - Date.now()) / 60000;
            const windowMin = dispatchConfig.reservations.activeDispatchWindowMinutes;

            if (timeDiffMin > windowMin) {
                console.log(`[DISPATCH-WINDOW-GATED] Job ${jobId} starts in ${timeDiffMin.toFixed(1)} mins (outside window of ${windowMin}m). Holding.`);
                await db.query("UPDATE jobs SET status = 'SCHEDULED', updated_at = NOW() WHERE id = $1", [jobId]);
                await this.logStateTransition(jobId, 'SCHEDULED_FUTURE');
                return;
            }
        }

        const isEmergencyQueue = queueType === 'EMERGENCY';

        // Initialize or fetch search analytics log (Step 14)
        let analyticsId = null;
        try {
            const existingAnalytics = await db.query("SELECT id FROM search_analytics_logs WHERE job_id = $1", [jobId]);
            if (existingAnalytics.rowCount === 0) {
                const isRural = ['Agriculture', 'Labour', 'Transport', 'Construction'].includes(job.category);
                const initRadius = isRural ? 5.0 : 3.0;
                const saRes = await db.query(`
                    INSERT INTO search_analytics_logs (job_id, initial_radius_km, expansion_count, workers_found, workers_ranked, notifications_sent, dispatch_time_seconds)
                    VALUES ($1, $2, 0, 0, 0, 0, 0) RETURNING id
                `, [jobId, initRadius]);
                analyticsId = saRes.rows[0].id;
            } else {
                analyticsId = existingAnalytics.rows[0].id;
            }
        } catch (saErr) {
            console.warn('[SEARCH-ANALYTICS-INIT-FAILED]', saErr.message);
        }

        // Update state to BUILD_QUEUE
        await this.logStateTransition(jobId, 'BUILD_QUEUE');

        // Step 1: BUILD CANDIDATE QUEUE
        const queueBuildStart = Date.now();
        const candidates = await this.buildCandidateQueue(job);
        const queueBuildTimeMs = Date.now() - queueBuildStart;

        // Update build metrics
        if (analyticsId) {
            await db.query(`
                UPDATE search_analytics_logs 
                SET workers_found = $1, workers_ranked = $2, queue_build_time_ms = $3, queue_refresh_count = queue_refresh_count + 1
                WHERE id = $4
            `, [candidates.length, candidates.length, queueBuildTimeMs, analyticsId]);
        }

        if (candidates.length === 0) {
            console.log(`[DISPATCH] No eligible candidates found for Job ${jobId}. Redistributing.`);
            await this.transitionToRedistributing(job, analyticsId);
            return;
        }

        // Step 8: STANDBY QUEUE FOR SCHEDULED JOBS
        if (job.scheduled_at && queueType !== 'SCHEDULED_RECOVERY') {
            console.log(`[DISPATCH-SCHEDULED] Job ${jobId} is scheduled at ${job.scheduled_at}. Creating standby queue.`);
            const primaryWorker = candidates[0];
            const standbyWorkers = candidates.slice(1, 1 + dispatchConfig.reservations.standbyBackupCount);

            // Store standby queue in Redis
            const standbyIds = standbyWorkers.map(w => w.id);
            if (standbyIds.length > 0) {
                await redis.set(`job:${jobId}:standby_queue`, JSON.stringify(standbyIds), 'EX', 86400);
            }

            // Assign primary worker (atomic reserve)
            const assigned = await this.assignJobAtomically(jobId, primaryWorker.id);
            if (assigned.success) {
                if (analyticsId) {
                    await db.query("UPDATE search_analytics_logs SET standby_used = true WHERE id = $1", [analyticsId]);
                }
                return;
            }
        }

        // Step 2: CREATE DISPATCH POOLS
        const pools = this.createDispatchPools(candidates, job.category, isEmergencyQueue);
        console.log(`[DISPATCH-POOLS] Created ${pools.length} pools for Job ${jobId}`);

        // Step 3 & 4: DISPATCH ONLY ONE POOL AT A TIME
        let hasBeenAccepted = false;
        let poolsUsed = 0;

        for (let i = 0; i < pools.length; i++) {
            poolsUsed++;
            const activePool = pools[i];
            const poolId = i + 1;
            const stateName = `POOL_${poolId}_ACTIVE`;

            // Refresh job state check to ensure it hasn't been cancelled or accepted
            const currentJob = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
            if (currentJob.rowCount === 0 || !['OPEN', 'REDISTRIBUTING', 'REASSIGNING', 'BUILD_QUEUE', 'SCHEDULED'].includes(currentJob.rows[0].status)) {
                hasBeenAccepted = true;
                break;
            }

            await this.logStateTransition(jobId, stateName);
            await db.query("UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2", [stateName, jobId]);

            console.log(`[DISPATCH-POOL] Activating ${stateName} with ${activePool.length} workers.`);

            // Send offers to active pool
            const offerIds = await this.notifyPool(job, activePool, poolId, isEmergencyQueue);

            if (analyticsId) {
                await db.query(`
                    UPDATE search_analytics_logs 
                    SET pools_used = $1, notifications_sent = notifications_sent + $2
                    WHERE id = $3
                `, [poolsUsed, activePool.length, analyticsId]);
            }

            // Wait for anyone to accept or pool failure (Step 6)
            const acceptResult = await this.waitForPoolAcceptance(jobId, offerIds, isEmergencyQueue);
            if (acceptResult) {
                hasBeenAccepted = true;
                break;
            }

            // Step 6: POOL FAILURE
            console.log(`[DISPATCH-POOL-FAIL] Pool ${poolId} failed to accept. Revoking stale offers.`);
            await this.revokePoolOffers(offerIds, analyticsId);
        }

        // If all pools failed, move to REDISTRIBUTING / continuous scan
        if (!hasBeenAccepted) {
            console.log(`[DISPATCH-POOL-FAIL-ALL] All pools exhausted for Job ${jobId}. Entering REDISTRIBUTING.`);
            await this.transitionToRedistributing(job, analyticsId);
        }
    }

    /**
     * Builds and ranks eligible candidates
     */
    async buildCandidateQueue(job) {
        const searchRadiusService = require('./search_radius.service');
        const isEmergency = job.category === 'Emergency' || job.priority === 'High' || job.priority === 'Critical';
        
        // Dynamically compute search radius limit
        let radiusLimit = process.env.NODE_ENV === 'development' ? 500 : searchRadiusService.getMaxRadius(job.category, isEmergency);
        if (isEmergency) {
            radiusLimit = radiusLimit * 1.5; // Larger search radius in Emergency (Step 25)
        }

        const queryText = `
            SELECT w.id, w.full_name, w.phone_number, w.photo_url, w.skills, w.experience, w.rating as raw_rating,
                   w.jobs_completed, w.is_online, w.is_available, w.current_lat, w.current_lng, w.verification_status, w.tasks,
                   w.updated_at as last_activity_time, w.availability_state,
                   r.trust_score as rep_trust_score, r.reliability_score as rep_reliability_score, r.overall_score as rep_overall_score,
                   earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 AS distance,
                   COALESCE((
                       SELECT COUNT(*) FROM jobs 
                       WHERE worker_id = w.id 
                         AND status = 'COMPLETED' 
                         AND completed_at >= CURRENT_DATE
                   ), 0) AS jobs_completed_today
            FROM workers w
            LEFT JOIN worker_reputation_scores r ON w.id = r.worker_id
            WHERE w.location_cube IS NOT NULL
              AND w.is_online = true
              AND w.is_available = true
              AND w.verification_status = 'VERIFIED'
              AND w.availability_state NOT IN ('SUSPENDED', 'BREAK')
              AND earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 <= $3
            ORDER BY distance ASC`;

        const dbWorkers = await db.query(queryText, [job.location_lat, job.location_lng, radiusLimit]);
        const candidates = [];

        for (const worker of dbWorkers.rows) {
            // Check Skill Match
            if (!isSkillMatch(worker.skills, worker.tasks, job.category)) continue;

            // Check Cooldown (Step 9): Did they recently reject or time out this job?
            const cooldownValue = await redis.get(`dispatch_lock:${job.id}:${worker.id}`);
            if (cooldownValue === 'rejected') continue;

            // Check Active Work Status (Not already busy)
            const activeJobCheck = await db.query(
                `SELECT id FROM jobs 
                 WHERE worker_id = $1 
                   AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION', 'WORK_IN_PROGRESS', 'IN_PROGRESS', 'STARTED')`,
                [worker.id]
            );
            if (activeJobCheck.rowCount > 0) continue;

            // Step 26: Conflict Detection &smart gap filling
            const duration = await reservationService.predictJobDuration(job.category);
            const conflictCheck = await reservationService.checkCalendarConflict(
                worker.id, 
                job.scheduled_at || new Date(), 
                duration, 
                job.category, 
                parseFloat(job.location_lat), 
                parseFloat(job.location_lng)
            );
            if (conflictCheck.conflict) {
                console.log(`[DISPATCH-REJECT-CONFLICT] Worker ${worker.id} excluded: ${conflictCheck.reason}`);
                continue;
            }

            // Smart Gap Filling for instant jobs
            if (!job.scheduled_at) {
                const gapCheck = await reservationService.evaluateGapFilling(
                    worker.id, 
                    duration, 
                    parseFloat(job.location_lat), 
                    parseFloat(job.location_lng)
                );
                if (!gapCheck) {
                    console.log(`[DISPATCH-REJECT-GAP-FILL] Worker ${worker.id} excluded: insufficient gap before next reservation`);
                    continue;
                }
            }

            // Score and Rank
            const score = await this.calculateRankingScore(worker, job);
            candidates.push({
                ...worker,
                score,
                distance: parseFloat(worker.distance || 0)
            });
        }

        // Sort candidates descending by ranking score (Step 10: Fairness & Multi-Factor)
        candidates.sort((a, b) => b.score - a.score);
        return candidates;
    }

    /**
     * Multi-factor scoring combining distance, acceptance likelihood, idle times, and earnings fairness
     */
    async calculateRankingScore(worker, job) {
        const reputationWeight = dispatchConfig.weights.reputation;
        const distanceWeight = dispatchConfig.weights.distance;
        const fairnessEarningsWeight = dispatchConfig.weights.fairnessEarnings;
        const fairnessIdleWeight = dispatchConfig.weights.fairnessIdle;

        const reputation = parseFloat(worker.rep_overall_score || 50) / 100.0;
        const distanceScore = 1.0 / (1.0 + parseFloat(worker.distance || 0));

        // Earnings fairness: Give boost to workers who completed fewer jobs today (anti-starvation)
        const jobsCompletedToday = parseInt(worker.jobs_completed_today || 0, 10);
        const earningsFairness = Math.max(0.0, 1.0 - (jobsCompletedToday / 5.0));

        // Idle time boost: Calculate duration since last activity
        const lastActivityMs = worker.last_activity_time ? new Date(worker.last_activity_time).getTime() : Date.now() - 3600000;
        const idleHours = Math.min(12.0, (Date.now() - lastActivityMs) / 3600000.0);
        const idleFairness = Math.min(1.0, idleHours / 12.0);

        // Fetch ML probability (Step 15)
        let pAccept = 0.5;
        try {
            const acceptanceResult = await rankingService.calculateAcceptanceProbability(worker, parseFloat(worker.distance || 0), job.price);
            pAccept = acceptanceResult.probability || 0.5;
        } catch (e) {}

        const score = (reputation * reputationWeight) +
                      (distanceScore * distanceWeight) +
                      (earningsFairness * fairnessEarningsWeight) +
                      (idleFairness * fairnessIdleWeight) +
                      (pAccept * dispatchConfig.weights.acceptanceProbability);

        // Subtract fatigue penalty (Step 10)
        let fatiguePenalty = 0.0;
        try {
            const fatigue = await fatigueService.calculateAdvancedFatigue(worker.id);
            fatiguePenalty = fatigue.score * 0.15;
        } catch (e) {}

        return Math.min(1.0, Math.max(0.0, score - fatiguePenalty));
    }

    /**
     * Create Pools from candidates (Step 2)
     */
    createDispatchPools(candidates, category, isEmergencyQueue = false) {
        let poolSizes;
        if (isEmergencyQueue) {
            // Larger pools for Emergency Dispatch (Step 25)
            poolSizes = { pool1Size: 5, pool2Size: 10, pool3Size: 15, pool4Size: 20 };
        } else {
            poolSizes = dispatchConfig.pools.categoryOverrides[category] || dispatchConfig.pools;
        }

        const pools = [];
        let index = 0;

        const sizes = [
            poolSizes.pool1Size, 
            poolSizes.pool2Size, 
            poolSizes.pool3Size,
            poolSizes.pool4Size || poolSizes.pool3Size
        ];

        for (const size of sizes) {
            if (index >= candidates.length) break;
            pools.push(candidates.slice(index, index + size));
            index += size;
        }

        // Add remaining workers to last pool if queue is large
        if (index < candidates.length) {
            if (pools.length > 0) {
                pools[pools.length - 1] = pools[pools.length - 1].concat(candidates.slice(index));
            } else {
                pools.push(candidates.slice(index));
            }
        }

        return pools;
    }

    /**
     * Sends offers to all workers in a pool simultaneously (Step 3 & 4)
     */
    async notifyPool(job, pool, poolId, isEmergencyQueue = false) {
        const { getIO } = require('../config/socket');
        const io = getIO();
        const offerIds = [];

        let ttl;
        if (isEmergencyQueue) {
            ttl = 10; // Shorter offer timeout for emergency dispatch (Step 25)
        } else {
            const poolConfig = dispatchConfig.pools.categoryOverrides[job.category] || dispatchConfig.pools;
            ttl = poolConfig.offerTtlSeconds;
        }
        
        const expiresAt = new Date(Date.now() + ttl * 1000);

        for (const worker of pool) {
            const dedupKey = `offer_lock:${job.id}:${worker.id}`;
            const locked = await redis.set(dedupKey, '1', 'NX', 'EX', ttl);
            if (!locked) continue;

            const res = await db.query(
                `INSERT INTO job_offers (job_id, worker_id, status, expires_at, dispatch_pool_id) 
                 VALUES ($1, $2, 'PENDING', $3, $4) RETURNING id`,
                [job.id, worker.id, expiresAt, poolId]
            );
            const offerId = res.rows[0].id;
            offerIds.push(offerId);

            // Notify via socket
            if (io) {
                io.to(`worker:${worker.phone_number}`).emit('new_job_request', {
                    ...job,
                    offerId,
                    distance: `${worker.distance.toFixed(1)} km`,
                    expiresIn: ttl,
                    poolId
                });
            }
        }

        return offerIds;
    }

    /**
     * Blocks or polls until an offer in the pool is accepted (Step 5)
     */
    async waitForPoolAcceptance(jobId, offerIds, isEmergencyQueue = false) {
        let ttl;
        if (isEmergencyQueue) {
            ttl = 10;
        } else {
            ttl = dispatchConfig.pools.offerTtlSeconds;
        }

        for (let i = 0; i < ttl; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check if any offer was accepted
            const acceptedCheck = await db.query(
                "SELECT id FROM job_offers WHERE job_id = $1 AND status = 'ACCEPTED'",
                [jobId]
            );
            if (acceptedCheck.rowCount > 0) return true;

            // Check if all offers in this pool were declined
            const pendingCheck = await db.query(
                "SELECT COUNT(*) FROM job_offers WHERE id = ANY($1) AND status = 'PENDING'",
                [offerIds]
            );
            if (parseInt(pendingCheck.rows[0].count, 10) === 0) {
                return false; // Exit early to next pool
            }
        }
        return false;
    }

    /**
     * Revokes offers when pool fails
     */
    async revokePoolOffers(offerIds, analyticsId) {
        if (offerIds.length === 0) return;

        // Atomic update status of expired/declined offers
        const result = await db.query(
            `UPDATE job_offers 
             SET status = 'EXPIRED' 
             WHERE id = ANY($1) AND status = 'PENDING' RETURNING id`,
            [offerIds]
        );

        if (analyticsId && result.rowCount > 0) {
            await db.query(
                "UPDATE search_analytics_logs SET offers_expired_count = offers_expired_count + $1 WHERE id = $2",
                [result.rowCount, analyticsId]
            );
        }
    }

    /**
     * Transition job to REDISTRIBUTING status when all pools fail
     */
    async transitionToRedistributing(job, analyticsId) {
        await this.logStateTransition(job.id, 'REDISTRIBUTING');
        await db.query("UPDATE jobs SET status = 'REDISTRIBUTING', updated_at = NOW() WHERE id = $1", [job.id]);
        await redis.set(`job:${job.id}:status`, 'REDISTRIBUTING');
    }

    /**
     * Atomic lock & transaction for offer acceptance (Step 5 / Step 13)
     */
    async acceptOfferAtomically(offerId, workerPhoneOrId) {
        const acceptLock = `job_accept_lock:${offerId}`;
        const locked = await redis.set(acceptLock, '1', 'NX', 'EX', 10);
        if (!locked) {
            return { success: false, error: "DUPLICATE_ACCEPT_ATTEMPT", message: "Another worker is currently accepting this job." };
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Fetch offer and lock it for update
            const offerRes = await client.query(
                "SELECT * FROM job_offers WHERE id = $1 FOR UPDATE",
                [offerId]
            );
            if (offerRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "OFFER_INVALID", message: "Offer not found." };
            }

            const offer = offerRes.rows[0];

            if (offer.status !== 'PENDING') {
                await client.query('ROLLBACK');
                return { success: false, error: "OFFER_EXPIRED", message: "Offer is no longer pending." };
            }

            if (new Date(offer.expires_at) < new Date()) {
                await client.query('ROLLBACK');
                return { success: false, error: "OFFER_EXPIRED", message: "Offer has expired." };
            }

            // 2. Fetch worker and verify identity
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerPhoneOrId);
            const workerRes = isUUID 
                ? await client.query("SELECT id, is_available, availability_state, phone_number FROM workers WHERE id = $1 FOR UPDATE", [workerPhoneOrId])
                : await client.query("SELECT id, is_available, availability_state, phone_number FROM workers WHERE phone_number = $1 FOR UPDATE", [workerPhoneOrId]);
            if (workerRes.rowCount === 0 || workerRes.rows[0].id !== offer.worker_id) {
                await client.query('ROLLBACK');
                return { success: false, error: "WORKER_INVALID", message: "Unauthorized worker." };
            }
            const worker = workerRes.rows[0];

            if (!worker.is_available || worker.availability_state === 'BUSY' || worker.availability_state === 'SUSPENDED') {
                await client.query('ROLLBACK');
                return { success: false, error: "WORKER_BUSY", message: "You already have an active job." };
            }

            // 3. Lock job and verify status is open/pool active
            const jobRes = await client.query(
                "SELECT id, status, user_id, category, scheduled_at, location_lat, location_lng FROM jobs WHERE id = $1 FOR UPDATE",
                [offer.job_id]
            );
            if (jobRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: "JOB_INVALID", message: "Job not found." };
            }

            const job = jobRes.rows[0];
            const activeStatuses = ['OPEN', 'REDISTRIBUTING', 'REASSIGNING', 'BUILD_QUEUE', 'SCHEDULED', 'POOL_1_ACTIVE', 'POOL_2_ACTIVE', 'POOL_3_ACTIVE'];
            if (!activeStatuses.includes(job.status)) {
                await client.query('ROLLBACK');
                return { success: false, error: "JOB_TAKEN", message: "Sorry, this job was just taken by another worker." };
            }

            // 4. Perform atomic assignment
            await client.query(
                `UPDATE jobs 
                 SET status = 'ACCEPTED', worker_id = $1, accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [worker.id, job.id]
            );

            // 5. Update accepted offer status
            await client.query(
                "UPDATE job_offers SET status = 'ACCEPTED' WHERE id = $1",
                [offerId]
            );

            // 6. Invalidate remaining offers in the active pool (Step 5)
            const revokedOffers = await client.query(
                `UPDATE job_offers 
                 SET status = 'REVOKED' 
                 WHERE job_id = $1 AND id != $2 AND status = 'PENDING' RETURNING worker_id`,
                [job.id, offerId]
            );

            // Step 26: Reserve Time Block in calendar
            const start = job.scheduled_at || new Date();
            await reservationService.reserveTimeBlock(
                worker.id, job.id, start, job.category,
                parseFloat(job.location_lat), parseFloat(job.location_lng),
                client
            );

            // Set availability state to BUSY (if instant) or RESERVED (if scheduled)
            const newState = job.scheduled_at ? 'RESERVED' : 'BUSY';
            await client.query(
                "UPDATE workers SET availability_state = $1 WHERE id = $2",
                [newState, worker.id]
            );

            await client.query('COMMIT');

            // Redis status sync
            await redis.set(`job:${job.id}:status`, 'ACCEPTED');
            await redis.del(`job:${job.id}:searching`);
            await redis.del(`job:${job.id}:dispatch_queue`);

            // Log Observability
            const saCheck = await db.query("SELECT id FROM search_analytics_logs WHERE job_id = $1", [job.id]);
            if (saCheck.rowCount > 0) {
                const acceptSec = Math.round((Date.now() - new Date(offer.created_at).getTime()) / 1000);
                await db.query(
                    `UPDATE search_analytics_logs 
                     SET is_completed = true, acceptance_time_seconds = $1
                     WHERE id = $2`,
                    [acceptSec, saCheck.rows[0].id]
                );
            }

            await this.logStateTransition(job.id, 'ASSIGNED', { workerId: worker.id });

            // Notify remaining pool workers that job is taken
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io && revokedOffers.rowCount > 0) {
                const revokedIds = revokedOffers.rows.map(r => r.worker_id);
                const workersRes = await db.query("SELECT phone_number FROM workers WHERE id = ANY($1)", [revokedIds]);
                for (const w of workersRes.rows) {
                    io.to(`worker:${w.phone_number}`).emit('job_taken', { jobId: job.id, message: "This gig was accepted by another worker." });
                }
            }

            return { success: true, jobId: job.id };
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("❌ Atomic Accept transaction error:", e.message);
            return { success: false, error: "TRANSACTION_FAILED", message: e.message };
        } finally {
            client.release();
            await redis.del(acceptLock);
        }
    }

    /**
     * Direct atomic assignment (standby queue / bypass)
     */
    async assignJobAtomically(jobId, workerId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            
            // Check worker availability
            const worker = await client.query("SELECT is_available, availability_state FROM workers WHERE id = $1 FOR UPDATE", [workerId]);
            if (worker.rowCount === 0 || !worker.rows[0].is_available || worker.rows[0].availability_state === 'BUSY') {
                await client.query('ROLLBACK');
                return { success: false };
            }

            const job = await client.query("SELECT status, category, scheduled_at, location_lat, location_lng FROM jobs WHERE id = $1 FOR UPDATE", [jobId]);
            if (job.rowCount === 0 || !['OPEN', 'REDISTRIBUTING', 'REASSIGNING', 'BUILD_QUEUE', 'SCHEDULED'].includes(job.rows[0].status)) {
                await client.query('ROLLBACK');
                return { success: false };
            }

            const jData = job.rows[0];

            // Assign
            await client.query(
                `UPDATE jobs 
                 SET status = 'ACCEPTED', worker_id = $1, accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [workerId, jobId]
            );

            // Step 26: Reserve time block in calendar
            const start = jData.scheduled_at || new Date();
            await reservationService.reserveTimeBlock(
                workerId, jobId, start, jData.category,
                parseFloat(jData.location_lat), parseFloat(jData.location_lng),
                client
            );

            const newState = jData.scheduled_at ? 'RESERVED' : 'BUSY';
            await client.query(
                "UPDATE workers SET availability_state = $1 WHERE id = $2",
                [newState, workerId]
            );

            await client.query('COMMIT');
            await redis.set(`job:${jobId}:status`, 'ACCEPTED');
            await this.logStateTransition(jobId, 'ASSIGNED', { workerId });

            return { success: true };
        } catch (e) {
            await client.query('ROLLBACK');
            return { success: false };
        } finally {
            client.release();
        }
    }

    /**
     * Emergency reassignment / Standby recovery (Step 12)
     */
    async handleEmergencyRecovery(jobId) {
        console.log(`⚠️ [EMERGENCY-RECOVERY] Reassigning Job ${jobId}`);

        // Try Standby queue from Redis first (Step 8)
        const standbyStr = await redis.get(`job:${jobId}:standby_queue`);
        if (standbyStr) {
            const standbyIds = JSON.parse(standbyStr);
            while (standbyIds.length > 0) {
                const nextWorkerId = standbyIds.shift();
                
                // Update standby queue in Redis
                if (standbyIds.length > 0) {
                    await redis.set(`job:${jobId}:standby_queue`, JSON.stringify(standbyIds), 'EX', 86400);
                } else {
                    await redis.del(`job:${jobId}:standby_queue`);
                }

                // Attempt to assign atomically
                const assigned = await this.assignJobAtomically(jobId, nextWorkerId);
                if (assigned.success) {
                    console.log(`[EMERGENCY-RECOVERY] Successfully assigned standby worker ${nextWorkerId} to Job ${jobId}`);
                    
                    // Log standby usage
                    const sa = await db.query("SELECT id FROM search_analytics_logs WHERE job_id = $1", [jobId]);
                    if (sa.rowCount > 0) {
                        await db.query(
                            `UPDATE search_analytics_logs 
                             SET standby_used = true, emergency_recovery_count = emergency_recovery_count + 1 
                             WHERE id = $1`,
                            [sa.rows[0].id]
                        );
                    }
                    return true;
                }
            }
        }

        // Standby unavailable, trigger Priority Redispatch matching
        console.log(`[EMERGENCY-RECOVERY] Standby queue exhausted for Job ${jobId}. Resuming dispatch from scratch.`);
        const sa = await db.query("SELECT id FROM search_analytics_logs WHERE job_id = $1", [jobId]);
        if (sa.rowCount > 0) {
            await db.query(
                "UPDATE search_analytics_logs SET emergency_recovery_count = emergency_recovery_count + 1 WHERE id = $1",
                [sa.rows[0].id]
            );
        }

        // Reset status to REDISTRIBUTING and run pipeline
        await db.query("UPDATE jobs SET status = 'REDISTRIBUTING', worker_id = NULL, accepted_at = NULL WHERE id = $1", [jobId]);
        this.broadcastJob(jobId).catch(() => {});
        return false;
    }

    /**
     * Declines an offer and adds worker to Cooldown (Step 9)
     */
    async declineOffer(offerId, workerId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const offerRes = await client.query(
                "SELECT * FROM job_offers WHERE id = $1 FOR UPDATE",
                [offerId]
            );
            if (offerRes.rowCount === 0 || offerRes.rows[0].worker_id !== workerId) {
                await client.query('ROLLBACK');
                return { success: false, error: "INVALID_OFFER" };
            }

            const offer = offerRes.rows[0];
            if (offer.status !== 'PENDING') {
                await client.query('ROLLBACK');
                return { success: false, error: "OFFER_ALREADY_PROCESSED" };
            }

            // Update status to DECLINED
            await client.query(
                "UPDATE job_offers SET status = 'DECLINED' WHERE id = $1",
                [offerId]
            );

            await client.query('COMMIT');

            // Apply Cooldown (Step 9): Do not dispatch this job to this worker for cooldown seconds
            const cooldownTtl = dispatchConfig.pools.cooldownSeconds;
            await redis.set(`dispatch_lock:${offer.job_id}:${workerId}`, 'rejected', 'EX', cooldownTtl);

            // Log decline metrics
            const sa = await db.query("SELECT id FROM search_analytics_logs WHERE job_id = $1", [offer.job_id]);
            if (sa.rowCount > 0) {
                await db.query(
                    "UPDATE search_analytics_logs SET offers_declined_count = offers_declined_count + 1 WHERE id = $1",
                    [sa.rows[0].id]
                );
            }

            return { success: true };
        } catch (e) {
            await client.query('ROLLBACK');
            return { success: false, error: e.message };
        } finally {
            client.release();
        }
    }

    /**
     * Log State Transitions to job_history (Step 11)
     */
    async logStateTransition(jobId, status, metadata = {}) {
        try {
            await db.query(
                `INSERT INTO job_history (job_id, status, metadata) 
                 VALUES ($1, $2, $3)`,
                [jobId, status, JSON.stringify(metadata)]
            );
            console.log(`[DISPATCH-STATE] Job ${jobId} transitioned to ${status}`);
        } catch (e) {
            console.error('[DISPATCH-STATE-LOG-ERROR]', e.message);
        }
    }
}

module.exports = new DispatchQueueService();
