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
const { isSkillMatch } = require('../utils/skill_matcher');

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

class MatchingService {
    init(io) {
        this.io = io;
        this.waitForRedisAndHydrate();
        setInterval(() => this.cleanupExpiredJobs(), 5 * 60000);
        setInterval(() => this.periodicRedispatch(), 3 * 60000);
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
        this.runDispatchPipeline(job.id).catch(err => {
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

        console.log(`🚀 [DISPATCH-PIPELINE] Staged Matching engine running for Job ${jobId}`);

        let currentRadius = 3;
        const maxRadius = 25;
        let radiusExpansionCount = 0;

        while (true) {
            const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
            if (jobRes.rowCount === 0) break;
            const job = jobRes.rows[0];

            if (!['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(job.status)) {
                console.log(`[DISPATCH-TERMINATE] Job ${jobId} status is ${job.status}. Terminating staged matching.`);
                break;
            }

            // Emit dynamic progress: Searching nearby... (Step 9)
            this.io.to(`user:${job.user_id}`).emit('searching_status', {
                status: 'SEARCHING_NEARBY',
                message: `Searching partners within ${currentRadius} km...`,
                radius: currentRadius,
                searchState: radiusExpansionCount >= 2 ? 3 : (radiusExpansionCount >= 1 ? 2 : 1)
            });

            // Update database search parameters for home screen ongoing carousel card
            await db.query(
                "UPDATE jobs SET search_radius_km = $1, search_state_stage = $2, updated_at = NOW() WHERE id = $3",
                [currentRadius, radiusExpansionCount + 1, jobId]
            );

            // Step 1: Parse Description Intent
            const intent = parseJobIntent(job.description, job.category);

            // Step 2 & 4: Fetch and Filter Candidates
            const candidates = await this.getStageCandidates(job, intent, currentRadius);

            if (candidates.length === 0) {
                if (currentRadius < maxRadius) {
                    currentRadius = currentRadius === 3 ? 5 : (currentRadius === 5 ? 8 : (currentRadius === 8 ? 12 : (currentRadius === 12 ? 20 : maxRadius)));
                    radiusExpansionCount++;
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                } else {
                    console.log(`[DISPATCH-FAIL] No candidate workers found in maximum radius ${maxRadius}km for Job ${jobId}.`);
                    await db.query("UPDATE jobs SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [jobId]);
                    await redis.set(`job:${jobId}:status`, 'FAILED');
                    
                    this.io.to(`user:${job.user_id}`).emit('searching_status', {
                        status: 'FAILED',
                        message: "No nearby workers available right now."
                    });
                    this.io.to(`user:${job.user_id}`).emit('JOB_DISPATCH_FAILED', { jobId });
                    break;
                }
            }

            // Exclusive One-by-One Dispatch Loop
            let hasAccepted = false;
            for (const candidate of candidates) {
                // Re-verify job status is still valid before sending
                const checkRes = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
                if (checkRes.rowCount === 0 || !['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(checkRes.rows[0].status)) {
                    hasAccepted = true;
                    break;
                }

                // Double check no active pending offer exists (to be completely safe)
                const activeOfferCheck = await db.query(
                    "SELECT id FROM job_offers WHERE job_id = $1 AND status = 'PENDING' AND expires_at > NOW()",
                    [jobId]
                );
                if (activeOfferCheck.rowCount > 0) {
                    // Wait for the existing offer to resolve
                    const existingOffer = activeOfferCheck.rows[0];
                    const resultState = await this.waitForAcceptanceOrRejection(jobId, existingOffer.id, 20);
                    if (resultState === 'ACCEPTED') {
                        hasAccepted = true;
                        break;
                    }
                    continue; // Proceed to next candidate
                }

                console.log(`[DISPATCH-EXCLUSIVE] Offering Job ${jobId} to Worker ${candidate.phone_number} (${candidate.full_name}) exclusively`);
                
                // Emit dynamic progress status to user
                this.io.to(`user:${job.user_id}`).emit('searching_status', {
                    status: 'WORKERS_REVIEWING',
                    message: `Waiting for response from closest expert...`,
                    reviewingCount: 1
                });

                // Create the exclusive offer (20 seconds TTL)
                const offerTtl = 20;
                const offerId = await this.createOffer(job, candidate, candidate.distance, candidate.pAccept, offerTtl);
                
                if (offerId) {
                    // Wait for this specific worker to accept, reject or timeout
                    const resultState = await this.waitForAcceptanceOrRejection(jobId, offerId, offerTtl);
                    if (resultState === 'ACCEPTED') {
                        hasAccepted = true;
                        break;
                    }
                }
            }

            // Expand radius if still not accepted
            if (currentRadius < maxRadius) {
                currentRadius = currentRadius === 3 ? 5 : (currentRadius === 5 ? 8 : (currentRadius === 8 ? 12 : (currentRadius === 12 ? 20 : maxRadius)));
                radiusExpansionCount++;
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.log(`[DISPATCH-FAIL] All candidate tiers exhausted at ${maxRadius}km for Job ${jobId}.`);
                await db.query("UPDATE jobs SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [jobId]);
                await redis.set(`job:${jobId}:status`, 'FAILED');
                
                this.io.to(`user:${job.user_id}`).emit('searching_status', {
                    status: 'FAILED',
                    message: "No nearby workers accepted the job request."
                });
                this.io.to(`user:${job.user_id}`).emit('JOB_DISPATCH_FAILED', { jobId });
                break;
            }
        }

        await redis.del(pipelineLock);
    }

    async getStageCandidates(job, intent, radiusKm) {
        let queryText;
        if (db.isPostgisAvailable()) {
            queryText = `
                SELECT w.*,
                       ST_Distance(
                           ST_SetSRID(ST_MakePoint(w.current_lng, w.current_lat), 4326)::geography,
                           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
                       ) / 1000.0 AS distance
                FROM workers w
                WHERE w.is_online = true
                  AND w.is_available = true
                  AND w.verification_status = 'VERIFIED'
                  AND ST_DWithin(
                      ST_SetSRID(ST_MakePoint(w.current_lng, w.current_lat), 4326)::geography,
                      ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                      $3 * 1000
                  )
                ORDER BY distance ASC`;
        } else {
            queryText = `
                SELECT w.*,
                       earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 AS distance
                FROM workers w
                WHERE w.is_online = true
                  AND w.is_available = true
                  AND w.verification_status = 'VERIFIED'
                  AND earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 <= $3
                ORDER BY distance ASC`;
        }

        const dbWorkers = await db.query(queryText, [job.location_lat, job.location_lng, radiusKm]);
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

        for (const worker of workers) {
            if (excludedIds.has(worker.id)) continue;
            
            // Skill and category matching (Step 2)
            if (!isSkillMatch(worker.skills, worker.tasks, job.category)) continue;

            const rep = await reputationService.getReputation(worker.id).catch(() => ({}));
            const fatigue = await fatigueService.calculateAdvancedFatigue(worker.id).catch(() => ({ score: 0, band: 'NONE' }));

            // Skip critical fatigue (Step 4)
            if (fatigue.band === 'CRITICAL') continue;

            // GPS Spoof / Shadow Ban Check
            const shadowPenalties = await shadowBanService.applyBanPenalties(worker.id, 1.0, 1.0);
            if (shadowPenalties.dispatch === 0.0) continue;

            // ML scoring components (Step 5)
            let skillConfidence = 0.5;
            try {
                const sc = await skillConfidenceService.getCategoryConfidence(worker.id, job.category);
                skillConfidence = (sc.confidence_score || 50) / 100.0;
            } catch (e) {}

            const reputation = parseFloat(rep.overall_score || 50) / 100.0;

            let pAccept = 0.5;
            try {
                const acceptanceResult = await rankingService.calculateAcceptanceProbability(worker, worker.distance, job.price);
                pAccept = acceptanceResult.probability || 0.5;
            } catch (e) {}

            const distanceScore = 1.0 / (1.0 + worker.distance);
            const availabilityScore = worker.is_available ? 1.0 : 0.5;
            const etaMinutes = worker.distance * 2.5; // approx 2.5 mins per km
            const etaScore = 1.0 / (1.0 + etaMinutes);
            const userPreferenceMatch = 1.0;
            const categoryExperience = Math.min(1.0, (worker.jobs_completed || 0) / 50.0);

            let score = 
                (0.25 * skillConfidence) +
                (0.20 * reputation) +
                (0.15 * pAccept) +
                (0.15 * distanceScore) +
                (0.10 * availabilityScore) +
                (0.05 * etaScore) +
                (0.05 * userPreferenceMatch) +
                (0.05 * categoryExperience);

            // Apply Penalties
            score -= (fatigue.score * 0.15);
            score *= shadowPenalties.visibility;

            // Step 13: Affinity boost
            const prevHired = await db.query(
                "SELECT COUNT(*) FROM jobs WHERE user_id = $1 AND worker_id = $2 AND status = 'COMPLETED'",
                [job.user_id, worker.id]
            );
            if (parseInt(prevHired.rows[0]?.count || 0) > 0) {
                score += 0.10;
            }

            candidates.push({
                ...worker,
                score: Math.min(1.0, Math.max(0.0, score)),
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

        for (const worker of workers) {
            await this.createOffer(job, worker, worker.distance, worker.pAccept, 20);
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
