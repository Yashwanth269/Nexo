const db = require('../config/db');
const redis = require('../config/redis');
const rankingService = require('./ranking.service');
const geoHashService = require('./geo_hash.service');
const searchRadiusService = require('./search_radius.service');
const shadowBanService = require('./shadow_ban.service');
const backupWorkerService = require('./backup_worker.service');
const skillConfidenceService = require('./skill_confidence.service');
const fatigueService = require('./fatigue.service');
const reputationService = require('./reputation.service');
const dispatchConfig = require('../config/dispatch.config');
const { isSkillMatch } = require('../utils/skill_matcher');

async function logDispatchEvent(jobId, eventType, metadata = {}, workerId = null) {
    try {
        const jobRes = await db.query("SELECT created_at, user_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount === 0) return;
        const job = jobRes.rows[0];
        const latencyMs = Date.now() - new Date(job.created_at).getTime();
        
        await db.query(`
            INSERT INTO event_logs (job_id, worker_id, user_id, event_type, metadata)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            jobId,
            workerId,
            job.user_id,
            eventType,
            JSON.stringify({
                ...metadata,
                latencyFromCreationMs: latencyMs,
                timestamp: new Date().toISOString()
            })
        ]);
        console.log(`[DISPATCH-EVENT] Logged ${eventType} for job ${jobId}`);
    } catch (e) {
        console.error('[DISPATCH-EVENT-ERROR]', e.message);
    }
}

function parseJobIntent(description, category) {
    const desc = (description || '').toLowerCase();
    let subcategory = category || '';
    let skills = [category || ''];
    let priority = 'Normal';

    // NLP intent classification
    if (desc.includes('fan') || desc.includes('cooler')) {
        subcategory = 'Ceiling Fan Repair';
        skills = ['Electrical Wiring', 'Fan Installation', 'Safety'];
    } else if (desc.includes('wire') || desc.includes('switch') || desc.includes('short circuit') || desc.includes('electrician')) {
        subcategory = 'Electrical Wiring';
        skills = ['Electrical Wiring', 'Troubleshooting', 'Safety'];
    } else if (desc.includes('tractor') || desc.includes('till') || desc.includes('plow')) {
        subcategory = 'Tractor Tilling';
        skills = ['Tractor Operator', 'Agriculture Equipment'];
    } else if (desc.includes('cement') || desc.includes('unload') || desc.includes('heavy') || desc.includes('brick')) {
        subcategory = 'Labour Loading';
        skills = ['Heavy Lifting', 'Labour', 'Construction Helper'];
    } else if (desc.includes('plumb') || desc.includes('leak') || desc.includes('tap') || desc.includes('pipe')) {
        subcategory = 'Leakage Repair';
        skills = ['Plumbing', 'Pipe Repair', 'Leak Detection'];
    } else if (desc.includes('ac') || desc.includes('air condition')) {
        subcategory = 'AC Service / Repair';
        skills = ['AC Repair', 'Appliance Troubleshooting'];
    }

    if (desc.includes('urgent') || desc.includes('immediate') || desc.includes('asap') || desc.includes('emergency')) {
        priority = 'High';
    }

    return { subcategory, skills, priority };
}

function getWorkerTier(worker) {
    const score = worker.rep_overall_score !== null && worker.rep_overall_score !== undefined ? parseFloat(worker.rep_overall_score) : null;
    const rating = worker.avg_rating !== null && worker.avg_rating !== undefined ? parseFloat(worker.avg_rating) : parseFloat(worker.raw_rating || 4.0);
    if (score !== null) {
        if (score >= 80) return 'A';
        if (score >= 60) return 'B';
        if (score >= 40) return 'C';
        return 'D';
    } else {
        if (rating >= 4.5) return 'A';
        if (rating >= 4.0) return 'B';
        if (rating >= 3.0) return 'C';
        return 'D';
    }
}

class MatchingService {
    init(io) {
        this.io = io;
        this.waitForRedisAndHydrate();
        this.startRedistributeLoop();
        setInterval(() => this.cleanupExpiredJobs(), 5 * 60000);
        setInterval(() => this.cleanupStaleWorkers(), 2 * 60000);
    }

    async waitForRedisAndHydrate() {
        const redis = require('../config/redis');
        let attempts = 0;
        while (!redis.isOpen && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 150));
            attempts++;
        }
        await this.hydrateActiveJobs();
    }

    async hydrateActiveJobs() {
        const jobService = require('./job.service');
        console.log("[HYDRATION] Warming up marketplace discovery engine...");
        try {
            const activeJobs = await db.query(
                "SELECT id, location_lat, location_lng FROM jobs WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING') AND created_at > NOW() - INTERVAL '10 hours'"
            );
            for (const job of activeJobs.rows) {
                await jobService.syncJobToRedis(job.id, job.location_lat, job.location_lng);
            }
            console.log(`[HYDRATION] Synchronized ${activeJobs.rowCount} active jobs.`);
        } catch (error) {
            console.error("[HYDRATION-FAILED]", error.message);
        }
    }

    async resolveWorker(idOrPhone) {
        if (!idOrPhone) return null;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrPhone);
        if (isUUID) {
            const res = await db.query("SELECT * FROM workers WHERE id = $1", [idOrPhone]);
            return res.rows[0] || null;
        }
        const res = await db.query("SELECT * FROM workers WHERE phone_number = $1", [idOrPhone]);
        return res.rows[0] || null;
    }

    async updateWorkerLocation(workerId, lat, lng) {
        const worker = await this.resolveWorker(workerId);
        if (!worker) return;

        try {
            await db.query(
                "UPDATE workers SET current_lat = $1::numeric, current_lng = $2::numeric, location_cube = ll_to_earth($1::double precision, $2::double precision) WHERE id = $3::uuid",
                [lat, lng, worker.id]
            );

            const geohash6 = geoHashService.encode(lat, lng, 6);
            const oldGeohash = await redis.get(`worker:${worker.id}:geohash`);
            if (oldGeohash && oldGeohash !== geohash6) {
                await redis.zrem(`workers:geo:${oldGeohash}`, worker.id);
            }
            await redis.geoadd(`workers:geo:${geohash6}`, lng, lat, worker.id);
            await redis.set(`worker:${worker.id}:geohash`, geohash6);
            await redis.sadd('workers:active_set', worker.id);
            await redis.set(`worker:${worker.id}:last_seen`, Date.now(), 'EX', 300);
            
            const executionService = require('./execution.service');
            await executionService.syncWorkerLocation(worker.id, lat, lng);

            await this.matchJobsForWorker(worker.id);
        } catch (error) {
            console.error("[GEO-UPDATE] Failed:", error.message);
        }
    }

    async checkNearbyJobsForWorker(workerId, lat, lng) {
        return this.matchJobsForWorker(workerId);
    }

    async matchJobsForWorker(workerId) {
        try {
            const worker = await this.resolveWorker(workerId);
            if (!worker) return;

            const jobService = require('./job.service');
            const dynamicRadius = await searchRadiusService.calculateRadius(
                worker.current_lat || 13.14,
                worker.current_lng || 78.14
            );
            const radius = process.env.NODE_ENV === 'development' ? 500 : dynamicRadius;
            const nearbyJobs = await jobService.fetchNearbyJobs(
                worker.current_lat || 13.14,
                worker.current_lng || 78.14,
                radius
            );

            for (const job of nearbyJobs) {
                if (!isSkillMatch(worker.skills, worker.tasks, job.category)) continue;

                // Never dispatch a gig to multiple workers at the same time: skip if another worker has a pending offer
                const activeOfferCheck = await db.query(
                    "SELECT id FROM job_offers WHERE job_id = $1 AND status = 'PENDING' AND expires_at > NOW()",
                    [job.id]
                );
                if (activeOfferCheck.rowCount > 0) continue;

                const exclusionCheck = await db.query(
                    `SELECT id FROM job_offers
                     WHERE job_id = $1 AND worker_id = $2
                     AND (status IN ('PENDING', 'ACCEPTED') OR (status = 'REJECTED' AND created_at > NOW() - INTERVAL '15 minutes'))
                     UNION
                     SELECT cancellation_id as id FROM job_cancellations
                     WHERE job_id = $1 AND worker_id = $2 AND created_at > NOW() - INTERVAL '30 minutes'`,
                    [job.id, worker.id]
                );

                if (exclusionCheck.rowCount > 0) continue;

                const acceptanceResult = await rankingService.calculateAcceptanceProbability(worker, job.distance || 5, job.price);
                if (acceptanceResult.accepted) {
                    await this.createOffer(job, worker, job.distance || 5, acceptanceResult.probability, 20);
                }
            }
        } catch (error) {
            console.error("[EVENT-MATCH] Error:", error.message);
        }
    }

    async createOffer(job, worker, distance, pAccept, customTtl = null) {
        try {
            const dedupKey = `offer_lock:${job.id}:${worker.id}`;
            const isRedispatched = ['REDISTRIBUTING', 'REASSIGNING'].includes(job.status);
            const offerTtl = customTtl || (isRedispatched ? 90 : 120);

            const lockAcquired = await redis.set(dedupKey, '1', 'NX', 'EX', offerTtl);
            if (!lockAcquired) return null;

            const expiresAt = new Date(Date.now() + offerTtl * 1000);
            const formattedDistance = distance < 1
                ? `${Math.round(distance * 1000)}m`
                : `${distance.toFixed(1)} km`;

            const result = await db.query(
                "INSERT INTO job_offers (job_id, worker_id, status, expires_at) VALUES ($1, $2, 'PENDING', $3) RETURNING id",
                [job.id, worker.id, expiresAt]
            );
            const offerId = result.rows[0].id;

            console.log(`[OFFER] ${offerId} to Worker ${worker.phone_number} (${formattedDistance}, ${offerTtl}s)`);

            this.io.to(`worker:${worker.phone_number}`).timeout(offerTtl * 1000).emit('new_job_request', {
                ...job,
                offerId,
                distance: formattedDistance,
                pAccept,
                expiresIn: offerTtl,
                isUrgent: isRedispatched,
                urgencyText: isRedispatched ? "Urgent Reassignment" : null
            }, (err) => {
                if (err) {
                    console.warn(`[SOCKET-ACK-TIMEOUT] Worker ${worker.phone_number} offer ${offerId}`);
                    db.query("UPDATE job_offers SET status = 'EXPIRED' WHERE id = $1", [offerId]).catch(() => {});
                    const workerService = require('./worker.service');
                    workerService.updateFatigueScore(worker.id, 'JOB_TIMEOUT');
                }
            });

            return offerId;
        } catch (error) {
            console.error("[OFFER-CREATE] Failed:", error.message);
            await redis.del(`offer_lock:${job.id}:${worker.id}`).catch(() => {});
            return null;
        }
    }

    async periodicRedispatch() {
        try {
            const activeJobs = await db.query(
                "SELECT * FROM jobs WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING') AND created_at > NOW() - INTERVAL '10 hours'"
            );
            for (const job of activeJobs.rows) {
                const isRedispatched = ['REDISTRIBUTING', 'REASSIGNING'].includes(job.status);
                const lockKey = `redispatch_lock:${job.id}`;
                const cooldown = isRedispatched ? 60 : 180;
                const locked = await redis.set(lockKey, '1', 'NX', 'EX', cooldown);
                if (locked) {
                    const jitter = Math.random() * 5000;
                    setTimeout(async () => {
                        try {
                            const currentStatusRes = await db.query("SELECT status FROM jobs WHERE id = $1", [job.id]);
                            if (currentStatusRes.rowCount > 0 && ['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(currentStatusRes.rows[0].status)) {
                                await this.broadcastJob(job);
                            }
                        } catch (err) {
                            console.error(`[STAGGERED-REDISPATCH] Job ${job.id}:`, err.message);
                        }
                    }, jitter);
                }
            }
        } catch (e) {
            console.error("[REDISPATCH-FAILED]", e.message);
        }
    }

    async broadcastJob(job) {
        const dispatchQueue = require('./dispatch_queue.service');
        dispatchQueue.broadcastJob(job.id).catch(err => {
            console.error(`[DISPATCH-PIPELINE-ERROR] Job ${job.id}:`, err.message);
        });
    }

    async runDispatchPipeline(jobId) {
        const pipelineLock = `dispatch_pipeline_running:${jobId}`;
        const locked = await redis.set(pipelineLock, '1', 'NX', 'EX', 600);
        if (!locked) {
            console.log(`[DISPATCH] Staged matching pipeline already running for Job ${jobId}`);
            return;
        }

        const notifiedWorkerIds = new Set();
        let hasAccepted = false;
        let analyticsId = null;
        let totalWorkersFound = 0;
        let totalWorkersRanked = 0;
        let totalNotificationsSent = 0;
        const pipelineStartMs = Date.now();

        try {
            // 1. Fetch current job info and verify active status
            const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
            if (jobRes.rowCount === 0) {
                await redis.del(pipelineLock);
                return;
            }
            const job = jobRes.rows[0];

            if (!['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(job.status)) {
                console.log(`[DISPATCH-TERMINATE] Job ${jobId} status is ${job.status}. Terminating staged matching.`);
                await redis.del(pipelineLock);
                return;
            }

            console.log(`🚀 [DISPATCH-PIPELINE] Staged Matching engine running for Job ${jobId}`);

            // Initialize search analytics record
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
                console.warn('[SEARCH-ANALYTICS-INIT]', saErr.message);
            }

            await logDispatchEvent(jobId, 'dispatch_started', { category: job.category, priority: job.priority });

            const searchRadiusService = require('./search_radius.service');
            const isEmergency = job.category === 'Emergency' || job.priority === 'High' || job.priority === 'Critical';
            const stages = searchRadiusService.getDispatchStages(job.category, isEmergency);

            for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
                const stage = stages[stageIdx];

                // Refresh job check inside loop
                const loopJobCheck = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
                if (loopJobCheck.rowCount === 0 || !['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(loopJobCheck.rows[0].status)) {
                    hasAccepted = true;
                    break;
                }

                const radiusKm = stage.radius;

                console.log(`[DISPATCH-STAGE] Running Stage ${stageIdx + 1} for Job ${jobId} (Radius: ${radiusKm}km, Tiers: ${stage.tiers.join(',')}, Max Notify: ${stage.notifyCount})`);

                // Log radius expansion event
                await logDispatchEvent(jobId, `radius_expansion_stage_${stageIdx + 1}`, { radiusKm, stageTiers: stage.tiers });

                // Emit dynamic progress status
                this.io.to(`user:${job.user_id}`).emit('searching_status', {
                    status: 'SEARCHING_NEARBY',
                    message: stage.statusMsg,
                    radius: radiusKm,
                    searchState: stage.searchState
                });

                // Update database search parameters for home screen ongoing carousel card
                await db.query(
                    "UPDATE jobs SET search_radius_km = $1, search_state_stage = $2, updated_at = NOW() WHERE id = $3",
                    [radiusKm, stage.searchState, jobId]
                );

                // Parse Description Intent
                const intent = parseJobIntent(job.description, job.category);

                // Fetch candidates within current radius
                const candidates = await this.getStageCandidates(job, intent, radiusKm);
                totalWorkersFound += candidates.length;

                // Filter candidates by stage tiers & exclusion list
                const stageCandidates = candidates.filter(w => {
                    const tier = getWorkerTier(w);
                    return stage.tiers.includes(tier) && !notifiedWorkerIds.has(w.id);
                });
                totalWorkersRanked += stageCandidates.length;

                // Select top N candidates
                const targets = stageCandidates.slice(0, stage.notifyCount);

                if (targets.length > 0) {
                    console.log(`[DISPATCH-STAGE] Notifying ${targets.length} workers simultaneously in Stage ${stageIdx + 1}`);
                    
                    // Mark as notified
                    targets.forEach(w => notifiedWorkerIds.add(w.id));
                    totalNotificationsSent += targets.length;

                    // Send offers to selected targets
                    await this.notifyWorkersForJob(job, targets);

                    // Wait for anyone to accept within offer TTL window
                    hasAccepted = await this.waitForAcceptance(jobId, dispatchConfig.pools.offerTtlSeconds);
                } else {
                    console.log(`[DISPATCH-STAGE] No new candidates found in Stage ${stageIdx + 1} (${radiusKm}km). Expanding immediately to next radius...`);
                }

                if (hasAccepted) {
                    // Flush analytics update on acceptance
                    const dispatchTimeSec = Math.round((Date.now() - pipelineStartMs) / 1000);
                    try {
                        if (analyticsId) {
                            await db.query(`
                                UPDATE search_analytics_logs
                                SET expansion_count = $1, workers_found = workers_found + $2,
                                    workers_ranked = workers_ranked + $3, notifications_sent = notifications_sent + $4,
                                    dispatch_time_seconds = $5
                                WHERE id = $6
                            `, [stageIdx + 1, totalWorkersFound, totalWorkersRanked, totalNotificationsSent, dispatchTimeSec, analyticsId]);
                        }
                    } catch (saFlushErr) { console.warn('[ANALYTICS-FLUSH]', saFlushErr.message); }
                    await logDispatchEvent(jobId, 'worker_accepted', { stage: stageIdx + 1, radiusKm });
                    break;
                }
            }

            // 2. Final check after all initial stages completed (~120s)
            if (!hasAccepted) {
                const finalJobCheck = await db.query(
                    "SELECT status, user_id, created_at FROM jobs WHERE id = $1", [jobId]
                );
                if (finalJobCheck.rowCount > 0 && ['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(finalJobCheck.rows[0].status)) {
                    const finalJob = finalJobCheck.rows[0];
                    const ageMs = Date.now() - new Date(finalJob.created_at).getTime();
                    const MAX_AGE_MS = 72 * 60 * 60 * 1000; // 72 hours (3 days)

                    // Flush search analytics
                    const dispatchTimeSec = Math.round((Date.now() - pipelineStartMs) / 1000);
                    try {
                        if (analyticsId) {
                            await db.query(`
                                UPDATE search_analytics_logs
                                SET expansion_count = $1, workers_found = workers_found + $2,
                                    workers_ranked = workers_ranked + $3, notifications_sent = notifications_sent + $4,
                                    dispatch_time_seconds = $5
                                WHERE id = $6
                            `, [stages.length, totalWorkersFound, totalWorkersRanked, totalNotificationsSent, dispatchTimeSec, analyticsId]);
                        }
                    } catch (saFlushErr) { console.warn('[ANALYTICS-FLUSH-FAIL]', saFlushErr.message); }

                    if (ageMs >= MAX_AGE_MS) {
                        // Job is older than 3 days — expire it
                        console.log(`[DISPATCH-EXPIRED] Job ${jobId} has been searching for 3+ days. Marking as EXPIRED.`);
                        await logDispatchEvent(jobId, 'job_expired', { ageHours: Math.round(ageMs / 3600000) });
                        await db.query("UPDATE jobs SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [jobId]);
                        await redis.set(`job:${jobId}:status`, 'EXPIRED');
                        this.io.to(`user:${finalJob.user_id}`).emit('searching_status', {
                            status: 'EXPIRED',
                            message: "We couldn't find a worker after 3 days. Your request has expired."
                        });
                    } else {
                        // Transition to REDISTRIBUTING mode (Continuous queue matching)
                        console.log(`[DISPATCH-REDISTRIBUTING] Active dispatch completed for Job ${jobId}. Entering continuous redistributing mode.`);
                        await logDispatchEvent(jobId, 'enter_redistributing_mode', {
                            ageSeconds: Math.round(ageMs / 1000),
                            stagesRun: stages.length,
                            workersNotified: totalNotificationsSent
                        });

                        await db.query(
                            "UPDATE jobs SET status = 'REDISTRIBUTING', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                            [jobId]
                        );
                        await redis.set(`job:${jobId}:status`, 'REDISTRIBUTING');

                        // Inform user job is in active queue
                        this.io.to(`user:${finalJob.user_id}`).emit('searching_status', {
                            status: 'SEARCHING_NEARBY',
                            message: "Looking for available partners across your area...",
                            radius: stages[stages.length - 1]?.radius || 30,
                            searchState: 3
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`[DISPATCH-PIPELINE-ERROR] Error on runDispatchPipeline for ${jobId}:`, err.message);
        } finally {
            await redis.del(pipelineLock);
        }
    }

    startRedistributeLoop() {
        if (this._redistributeInterval) return;
        console.log('🔄 [REDISTRIBUTE-ENGINE] Initializing 30s continuous redistributing loop...');
        this._redistributeInterval = setInterval(() => {
            this.processRedistributingJobs().catch(err => {
                console.error('⚠️ [REDISTRIBUTE-LOOP-ERROR]', err.message);
            });
        }, 30000); // Runs every 30 seconds
    }

    async processRedistributingJobs() {
        try {
            // Find all active jobs in REDISTRIBUTING / OPEN status created > 120s ago
            const activeJobsRes = await db.query(`
                SELECT * FROM jobs 
                WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')
                  AND created_at <= NOW() - INTERVAL '120 seconds'
                ORDER BY created_at ASC
            `);

            const jobs = activeJobsRes.rows;
            if (jobs.length === 0) return;

            const now = Date.now();
            const MAX_AGE_MS = 72 * 60 * 60 * 1000; // 3 days

            for (const job of jobs) {
                const ageMs = now - new Date(job.created_at).getTime();

                // 1. Expiration Check (3 Days)
                if (ageMs >= MAX_AGE_MS) {
                    console.log(`[DISPATCH-EXPIRED] Job ${job.id} searching for 3+ days. Marking as EXPIRED.`);
                    await db.query("UPDATE jobs SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id]);
                    await redis.set(`job:${job.id}:status`, 'EXPIRED');
                    await logDispatchEvent(job.id, 'job_expired', { ageHours: Math.round(ageMs / 3600000) });
                    if (this.io) {
                        this.io.to(`user:${job.user_id}`).emit('searching_status', {
                            status: 'EXPIRED',
                            message: "We couldn't find a worker after 3 days. Your request has expired."
                        });
                    }
                    continue;
                }

                // 2. Redis Distributed Lock to prevent duplicate concurrent scans
                const tickLockKey = `redistribute_tick:${job.id}`;
                const locked = await redis.set(tickLockKey, '1', 'NX', 'EX', 25);
                if (!locked) continue;

                try {
                    const dispatchQueue = require('./dispatch_queue.service');
                    await dispatchQueue.broadcastJob(job.id);
                } catch (tickErr) {
                    console.error(`[REDISTRIBUTE-TICK-ERROR] Job ${job.id}:`, tickErr.message);
                }
            }
        } catch (err) {
            console.error('[PROCESS-REDISTRIBUTING-ERROR]', err.message);
        }
    }

    async getStageCandidates(job, intent, radiusKm) {
        // Query ALL workers within a wide 50km radius to allow evaluation & rejection logging
        let queryText = `
            SELECT w.id, w.full_name, w.phone_number, w.photo_url, w.skills, w.experience, w.rating as raw_rating,
                   w.jobs_completed, w.is_online, w.is_available, w.current_lat, w.current_lng, w.verification_status, w.tasks,
                   w.updated_at as last_activity_time,
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
              AND earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 <= 50.0
            ORDER BY distance ASC`;

        const dbWorkers = await db.query(queryText, [job.location_lat, job.location_lng]);
        const workers = dbWorkers.rows.map(w => ({
            ...w,
            distance: parseFloat(w.distance || 0)
        }));

        const exclusions = await db.query(
            `SELECT DISTINCT worker_id FROM job_offers
             WHERE job_id = $1
             AND (status IN ('PENDING', 'ACCEPTED') OR (status = 'REJECTED' AND created_at > NOW() - INTERVAL '15 minutes'))
             UNION
             SELECT DISTINCT worker_id FROM job_cancellations
             WHERE job_id = $1 AND created_at > NOW() - INTERVAL '30 minutes'`,
            [job.id]
        );
        const excludedIds = new Set(exclusions.rows.map(r => r.worker_id));

        const candidates = [];
        const shadowBanService = require('./shadow_ban.service');
        const fatigueService = require('./fatigue.service');
        const reputationService = require('./reputation.service');
        const dispatchConfig = require('../config/dispatch.config');

        const logRejection = async (workerId, reason, score = 0.0) => {
            try {
                await db.query(`
                    CREATE TABLE IF NOT EXISTS dispatch_rejection_logs (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                        job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
                        dispatch_score DECIMAL DEFAULT 0.0,
                        reject_reason VARCHAR(255) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                const check = await db.query(
                    "SELECT id FROM dispatch_rejection_logs WHERE job_id = $1 AND worker_id = $2 AND reject_reason = $3",
                    [job.id, workerId, reason]
                );
                if (check.rowCount === 0) {
                    await db.query(
                        `INSERT INTO dispatch_rejection_logs (job_id, worker_id, dispatch_score, reject_reason)
                         VALUES ($1, $2, $3, $4)`,
                        [job.id, workerId, score, reason]
                    );
                }
            } catch (e) {
                // Non-critical rejection log write
            }
        };

        for (const worker of workers) {
            // Check 1: Distance
            if (worker.distance > radiusKm) {
                await logRejection(worker.id, 'Distance');
                continue;
            }

            // Check 2: Online
            if (!worker.is_online) {
                await logRejection(worker.id, 'Offline');
                continue;
            }

            // Check 3: Available
            if (!worker.is_available) {
                await logRejection(worker.id, 'Busy');
                continue;
            }

            // Check 4: Verification
            if (worker.verification_status !== 'VERIFIED') {
                await logRejection(worker.id, 'Unverified');
                continue;
            }

            // Check 5: Exclusions
            if (excludedIds.has(worker.id)) {
                await logRejection(worker.id, 'Already working');
                continue;
            }
            
            // Check 6: Skill match
            if (!isSkillMatch(worker.skills, worker.tasks, job.category)) {
                await logRejection(worker.id, 'Skill mismatch');
                continue;
            }

            const rep = await reputationService.getReputation(worker.id).catch(() => ({}));
            const fatigue = await fatigueService.calculateAdvancedFatigue(worker.id).catch(() => ({ score: 0, band: 'NONE' }));

            // Check 7: Fatigue
            if (fatigue.band === 'CRITICAL') {
                await logRejection(worker.id, 'Fatigue');
                continue;
            }

            // Check 8: Shadow ban
            const shadowPenalties = await shadowBanService.applyBanPenalties(worker.id, 1.0, 1.0);
            if (shadowPenalties.dispatch === 0.0) {
                await logRejection(worker.id, 'Shadow banned');
                continue;
            }

            // Check 9: Trust score
            const trustVal = worker.rep_trust_score !== null ? parseFloat(worker.rep_trust_score) : 50;
            if (trustVal < 40) {
                await logRejection(worker.id, 'Trust too low');
                continue;
            }

            // Check 10: Reputation
            const repVal = worker.rep_overall_score !== null ? parseFloat(worker.rep_overall_score) : 50;
            if (repVal < 40) {
                await logRejection(worker.id, 'Reputation too low');
                continue;
            }

            // Score computation
            let skillConfidence = 0.5;
            try {
                const sc = await skillConfidenceService.getCategoryConfidence(worker.id, job.category);
                skillConfidence = (sc.confidence_score || 50) / 100.0;
            } catch (e) {}

            const reputation = repVal / 100.0;

            let pAccept = 0.5;
            try {
                const acceptanceResult = await rankingService.calculateAcceptanceProbability(worker, worker.distance, job.price);
                pAccept = acceptanceResult.probability || 0.5;
            } catch (e) {}

            const distanceScore = 1.0 / (1.0 + worker.distance);
            const availabilityScore = worker.is_available ? 1.0 : 0.5;
            const etaMinutes = worker.distance * 2.5; // approx 2.5 mins per km
            const etaScore = 1.0 / (1.0 + etaMinutes);

            // Fairness Sub-Scores (Earnings & Idle Time Anti-Starvation)
            const jobsCompletedToday = parseInt(worker.jobs_completed_today || 0, 10);
            const fairnessEarningsScore = Math.max(0.0, 1.0 - (jobsCompletedToday / 5.0));
            
            const lastActivityMs = worker.last_activity_time ? new Date(worker.last_activity_time).getTime() : Date.now() - 3600000;
            const idleHours = Math.min(12.0, (Date.now() - lastActivityMs) / 3600000.0);
            const fairnessIdleScore = Math.min(1.0, idleHours / 12.0);

            // Compute sub-components using centralized weights
            const compSkill = dispatchConfig.weights.skillConfidence * skillConfidence;
            const compRep = dispatchConfig.weights.reputation * reputation;
            const compAccept = dispatchConfig.weights.acceptanceProbability * pAccept;
            const compDist = dispatchConfig.weights.distance * distanceScore;
            const compFairnessEarnings = dispatchConfig.weights.fairnessEarnings * fairnessEarningsScore;
            const compFairnessIdle = dispatchConfig.weights.fairnessIdle * fairnessIdleScore;
            const compAvail = dispatchConfig.weights.availability * availabilityScore;
            const compEta = dispatchConfig.weights.eta * etaScore;

            let score = compSkill + compRep + compAccept + compDist + compFairnessEarnings + compFairnessIdle + compAvail + compEta;

            // Apply Penalties
            const fatiguePenalty = fatigue.score * 0.15;
            score -= fatiguePenalty;
            score *= shadowPenalties.visibility;

            // Affinity boost
            let affinityBoost = 0.0;
            const prevHired = await db.query(
                "SELECT COUNT(*) FROM jobs WHERE user_id = $1 AND worker_id = $2 AND status = 'COMPLETED'",
                [job.user_id, worker.id]
            );
            if (parseInt(prevHired.rows[0]?.count || 0) > 0) {
                affinityBoost = 0.10;
                score += affinityBoost;
            }

            const finalScore = Math.min(1.0, Math.max(0.0, score));

            // Log detailed ranking breakdown to DB (Point 14)
            try {
                await db.query(`
                    INSERT INTO dispatch_ranking_breakdowns (
                        job_id, worker_id, final_score, skill_score, distance_score,
                        acceptance_probability, trust_score, availability_score, eta_score,
                        fatigue_penalty, fraud_penalty
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    job.id,
                    worker.id,
                    finalScore * 100, // format as out of 100 for display (e.g. 92)
                    compSkill * 100,
                    compDist * 100,
                    compAccept * 100,
                    trustVal,
                    compAvail * 100,
                    compEta * 100,
                    -fatiguePenalty * 100,
                    0.0 // fraud penalty placeholder
                ]);
            } catch (breakdownErr) {
                console.error('[RANKING-BREAKDOWN-ERROR]', breakdownErr.message);
            }

            candidates.push({
                ...worker,
                score: finalScore,
                pAccept,
                etaMinutes
            });
        }

        // Contextual Bandit Exploration: 10% newer worker quotas
        const EXPLOIT_RATE = 0.90;
        const rng = Math.random();
        if (rng > EXPLOIT_RATE && candidates.length > 2) {
            candidates.sort(() => Math.random() - 0.5);
        } else {
            candidates.sort((a, b) => b.score - a.score);
        }

        return candidates;
    }

    async notifyWorkersForJob(job, workers) {
        console.log(`[DISPATCH-NOTIFY] Stage notify ${workers.length} workers for Job ${job.id}`);

        const activeCount = workers.length;
        this.io.to(`user:${job.user_id}`).emit('searching_status', {
            status: 'WORKERS_REVIEWING',
            message: `${activeCount} worker${activeCount > 1 ? 's' : ''} reviewing...`,
            reviewingCount: activeCount
        });

        const dispatchConfig = require('../config/dispatch.config');
        for (const worker of workers) {
            await this.createOffer(job, worker, worker.distance, worker.pAccept, dispatchConfig.pools.offerTtlSeconds);
        }
    }

    async waitForAcceptance(jobId, seconds) {
        for (let i = 0; i < seconds; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const jobRes = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
            if (jobRes.rowCount > 0 && jobRes.rows[0].status === 'ACCEPTED') {
                return true;
            }
        }
        return false;
    }

    async waitForAcceptanceOrRejection(jobId, offerId, seconds) {
        for (let i = 0; i < seconds; i++) {
            await new Promise(r => setTimeout(r, 1000));
            
            // Check if job was accepted (either by this worker or via offer validation)
            const jobRes = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
            if (jobRes.rowCount > 0 && jobRes.rows[0].status === 'ACCEPTED') {
                return 'ACCEPTED';
            }

            // Check if the specific offer was rejected or expired
            const offerRes = await db.query("SELECT status FROM job_offers WHERE id = $1", [offerId]);
            if (offerRes.rowCount > 0 && offerRes.rows[0].status !== 'PENDING') {
                return offerRes.rows[0].status; // 'REJECTED' or 'EXPIRED'
            }
        }
        return 'TIMEOUT';
    }

    async getNearbyRankedWorkers(job, radiusKm, round) {
        const intent = parseJobIntent(job.description, job.category);
        const candidates = await this.getStageCandidates(job, intent, radiusKm);
        return candidates;
    }

    async cleanupExpiredJobs() {
        try {
            await db.query("UPDATE job_offers SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < NOW()");
            const expired = await db.query(
                "UPDATE jobs SET status = 'EXPIRED' WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING') AND created_at < NOW() - INTERVAL '10 hours' RETURNING id, user_id"
            );
            for (const job of expired.rows) {
                this.io.to(`user:${job.user_id}`).emit('job_expired', { jobId: job.id });
                const geohash = await redis.get(`job:${job.id}:geohash`);
                if (geohash) {
                    await redis.zrem(`jobs:geo:${geohash}`, job.id);
                }
                await redis.del(`job:${job.id}:geohash`);
                await redis.srem('jobs:active_set', job.id);
            }
        } catch (e) {
            console.error("[CLEANUP-FAILED]", e.message);
        }
    }

    async cleanupStaleWorkers() {
        try {
            const workerIds = await redis.smembers('workers:active_set');
            for (const workerId of workerIds) {
                const lastSeen = await redis.get(`worker:${workerId}:last_seen`);
                if (!lastSeen) {
                    const misses = await redis.incr(`worker:${workerId}:missed_heartbeats`);
                    if (misses >= 3) {
                        await redis.srem('workers:active_set', workerId);
                        const geohash = await redis.get(`worker:${workerId}:geohash`);
                        if (geohash) {
                            await redis.zrem(`workers:geo:${geohash}`, workerId);
                        }
                        await redis.del(`worker:${workerId}:geohash`);
                        await redis.del(`worker:${workerId}:missed_heartbeats`);
                        await db.query("UPDATE workers SET is_online = false WHERE id = $1", [workerId]).catch(() => {});
                        console.log(`[CLEANUP] Removed stale worker ${workerId}`);

                        const activeJobsRes = await db.query(
                            `SELECT * FROM jobs
                             WHERE worker_id = $1
                             AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION')`,
                            [workerId]
                        );
                        for (const job of activeJobsRes.rows) {
                            console.log(`[GIG_TIMEOUT] Worker ${workerId} went offline. Reopening Job ${job.id}`);

                            const result = await backupWorkerService.handleFailure(job.id, 'WORKER_OFFLINE', { 
                                originalWorkerId: workerId,
                                reason: 'Worker connection timeout'
                            });

                            if (!result.success) {
                                await db.query(
                                    `UPDATE jobs
                                     SET status = 'REDISTRIBUTING', worker_id = NULL,
                                         accepted_at = NULL, on_the_way_at = NULL, arrived_at = NULL, started_at = NULL,
                                         cancellation_reason = 'Worker connection timeout', cancelled_by = 'SYSTEM',
                                         updated_at = CURRENT_TIMESTAMP
                                     WHERE id = $1`,
                                     [job.id]
                                );
                            }

                            await db.query(
                                `INSERT INTO job_cancellations (job_id, worker_id, reason, note)
                                 VALUES ($1, $2, 'Worker connection timeout', 'Auto-released due to inactivity')`,
                                [job.id, workerId]
                            );

                            const workerService = require('./worker.service');
                            await workerService.updateFatigueScore(workerId, 'JOB_TIMEOUT');

                            await this.invalidateJobCaches(job.id, workerId);
                            await redis.set(`job:${job.id}:status`, 'REDISTRIBUTING');

                            const jobGeohash = geoHashService.encode(job.location_lat, job.location_lng, 6);
                            await redis.geoadd(`jobs:geo:${jobGeohash}`, job.location_lng, job.location_lat, job.id);
                            await redis.set(`job:${job.id}:geohash`, jobGeohash);
                            await redis.sadd('jobs:active_set', job.id);

                            const payload = {
                                jobId: job.id,
                                reason: "Worker connection timeout",
                                message: "Worker disconnected. Reopening the gig."
                            };
                            this.io.to(`user:${job.user_id}`).emit('WORKER_CANCELLED_JOB', payload);
                            this.io.to(`user:${job.user_id}`).emit('WORKER_CANCELLED_GIG', payload);

                            const geoKey6 = geoHashService.encode(job.location_lat, job.location_lng, 6);
                            this.io.to(`trending:${geoKey6}`).emit('JOB_REOPENED', { jobId: job.id, status: 'REDISTRIBUTING' });

                            const updatedJobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [job.id]);
                            await this.broadcastJob(updatedJobRes.rows[0]);
                        }
                    }
                } else {
                    await redis.set(`worker:${workerId}:missed_heartbeats`, 0);
                }
            }
        } catch (e) {
            console.error("[STALE-WORKER-CLEANUP]", e.message);
        }
    }

    async logDispatchEvent(jobId, eventType, metadata = {}, workerId = null) {
        return logDispatchEvent(jobId, eventType, metadata, workerId);
    }

    async invalidateJobCaches(jobId, workerId = null) {
        await redis.del(`job:${jobId}:status`).catch(() => {});
        await redis.del(`job:${jobId}:details`).catch(() => {});
        if (workerId) {
            await redis.del(`worker:${workerId}:active_job`).catch(() => {});
        }
        await redis.del(`redispatch_lock:${jobId}`).catch(() => {});
        try {
            const patternOffer = `offer_lock:${jobId}:*`;
            const patternDispatch = `dispatch_lock:${jobId}:*`;
            if (redis.isMock) {
                for (const key of redis.store.keys()) {
                    if (key.startsWith(`offer_lock:${jobId}:`) || key.startsWith(`dispatch_lock:${jobId}:`)) {
                        redis.store.delete(key);
                    }
                }
            } else {
                const keysOffer = await redis.keys(patternOffer).catch(() => []);
                const keysDispatch = await redis.keys(patternDispatch).catch(() => []);
                const allKeys = [...keysOffer, ...keysDispatch];
                if (allKeys.length > 0) {
                    await redis.del(...allKeys).catch(() => {});
                }
            }
        } catch (e) {
            console.warn(`[CACHE-INVALIDATION]`, e.message);
        }
    }
}

module.exports = new MatchingService();
