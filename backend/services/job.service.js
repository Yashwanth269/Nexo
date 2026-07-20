const db = require('../config/db');
const redis = require('../config/redis');
const matchingService = require('./matching.service');
const userTrustService = require('./user_trust.service');
const backupWorkerService = require('./backup_worker.service');

async function logWorkerResponse(workerId, jobId, responseType, reason = null) {
    try {
        await db.query(`
            INSERT INTO worker_response_logs (worker_id, job_id, response_type, reason)
            VALUES ($1, $2, $3, $4)
        `, [workerId, jobId, responseType, reason]);
        console.log(`[WORKER-RESPONSE] Worker ${workerId} → ${responseType} for Job ${jobId}`);
    } catch (e) {
        console.error('[WORKER-RESPONSE-LOG-ERROR]', e.message);
    }
}

class JobService {
    async acceptJob(jobId, workerId) {
        const { getIO } = require('../config/socket');
        const io = getIO();
        let client;
        try {
            const worker = await matchingService.resolveWorker(workerId);
            if (!worker) {
                console.error(`[JOB_ACCEPT_FAILED] Worker ${workerId} not found in database`);
                return { success: false, message: "WORKER_NOT_FOUND" };
            }

            // 2. Redis Distributed Lock (prevents race condition between two workers)
            const lockKey = `job:${jobId}:accept_lock`;
            const lockAcquired = await redis.set(lockKey, worker.id, 'NX', 'EX', 10);
            if (!lockAcquired) {
                console.warn(`[JOB_ACCEPT_FAILED] Lock contention on job ${jobId}`);
                return { success: false, message: "JOB_ACCEPT_IN_PROGRESS" };
            }

            client = await db.pool.connect();

            // 3. WORKER BUSY CHECK (Multi-Job Prevention)
            const busyCheck = await client.query(
                `SELECT COUNT(*) FROM jobs 
                 WHERE worker_id = $1 
                 AND status IN ('ACCEPTED', 'SCHEDULED', 'READY_TO_START', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'WORK_IN_PROGRESS', 'STARTED')`,
                [worker.id]
            );
            if (parseInt(busyCheck.rows[0].count) >= 1) {
                console.warn(`[JOB_ACCEPT_FAILED] Worker ${worker.id} is already busy`);
                await redis.del(lockKey);
                return { success: false, message: "WORKER_ALREADY_BUSY" };
            }

            await client.query('BEGIN');

            // 4. SELECT FOR UPDATE — Row-level lock prevents concurrent updates
            const lockResult = await client.query(
                `SELECT id, status, user_id, scheduled_at FROM jobs WHERE id = $1 FOR UPDATE`,
                [jobId]
            );

            if (lockResult.rowCount === 0) {
                await client.query('ROLLBACK');
                await redis.del(lockKey);
                return { success: false, message: "JOB_NOT_FOUND" };
            }

            if (!['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(lockResult.rows[0].status)) {
                await client.query('ROLLBACK');
                await redis.del(lockKey);
                return { success: false, message: "JOB_ALREADY_TAKEN" };
            }

            const isScheduled = lockResult.rows[0].scheduled_at != null;
            const assignStatus = isScheduled ? 'RESERVED' : 'ACCEPTED';

            // 5. Atomic Assignment
            const result = await client.query(
                `UPDATE jobs 
                 SET worker_id = $1, status = $3, accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2 AND status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING') 
                 RETURNING *`,
                [worker.id, jobId, assignStatus]
            );

            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                await redis.del(lockKey);
                return { success: false, message: "JOB_ALREADY_TAKEN" };
            }

            const job = result.rows[0];

            // 6. Cancel all competing offers
            await client.query(
                "UPDATE job_offers SET status = 'CANCELLED' WHERE job_id = $1 AND status = 'PENDING'",
                [jobId]
            );

            await client.query('COMMIT');
            console.log(`[JOB_ACCEPT_SUCCESS] Job ${jobId} assigned to ${worker.id}`);

            // 7. Redis Cleanup
            await redis.del(`job:${jobId}:searching`);
            await redis.del(`job:${jobId}:dispatch_queue`);
            const geohash = await redis.get(`job:${jobId}:geohash`);
            if (geohash) {
                await redis.zrem(`jobs:geo:${geohash}`, jobId);
            }
            await redis.del(`job:${jobId}:geohash`);
            await redis.srem('jobs:active_set', jobId);
            await redis.set(`job:${jobId}:status`, 'ACCEPTED', 'EX', 3600);
            await redis.del(lockKey);
            const { invalidateAllHomeServicesCaches } = require('../routes/home.routes');
            await invalidateAllHomeServicesCaches().catch(() => {});

            const feedService = require('./feed.service');
            await feedService.invalidateFeedCache(job.location_lat, job.location_lng).catch(() => {});

            // Log worker response for ML training
            logWorkerResponse(worker.id, jobId, 'ACCEPTED').catch(() => {});
            matchingService.logDispatchEvent(jobId, 'worker_accepted', { workerId: worker.id }).catch(() => {});

            // 7.5 Auto-reserve backup workers
            backupWorkerService.autoReserveOnAcceptance(jobId, worker.id).catch(e => {
                console.warn('[BACKUP_WORKER] Auto-reserve failed:', e.message);
            });

            // 8. Realtime Broadcast
            io.emit('job_taken', { jobId, workerId: worker.id });
            
            // Fetch directions dynamically
            const { getDirections } = require('../utils/google_maps');
            let route_polyline = '';
            let route_distance = 0;
            let route_duration = 0;
            let formattedDistance = '0 km';
            let formattedEta = '15-20 mins';

            if (worker.current_lat && worker.current_lng && job.location_lat && job.location_lng) {
                try {
                    const directions = await getDirections(
                        parseFloat(worker.current_lat),
                        parseFloat(worker.current_lng),
                        parseFloat(job.location_lat),
                        parseFloat(job.location_lng)
                    );
                    route_polyline = directions.polyline;
                    route_distance = directions.distanceMeters;
                    route_duration = directions.durationSeconds;
                    
                    const km = route_distance / 1000;
                    formattedDistance = km < 1 ? `${Math.round(route_distance)}m` : `${km.toFixed(1)} km`;
                    formattedEta = `${Math.round(route_duration / 60)} mins`;

                    // Update job record with route info
                    await db.query(
                        "UPDATE jobs SET route_polyline = $1, route_distance = $2, route_duration = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
                        [route_polyline, route_distance, route_duration, jobId]
                    );

                    // Cache in Redis for throttling check
                    await redis.set(`job:${jobId}:last_directions_time`, Date.now());
                    await redis.set(`job:${jobId}:last_directions_lat`, worker.current_lat);
                    await redis.set(`job:${jobId}:last_directions_lng`, worker.current_lng);
                } catch (dirErr) {
                    console.error("⚠️ [JOB_ACCEPT] Directions fetch failed:", dirErr.message);
                }
            }
            
            const acceptancePayload = {
                job_id: jobId,
                status: "ACCEPTED",
                worker_id: worker.id,
                worker_name: worker.full_name || "Worker",
                worker_rating: worker.rating || 4.8,
                worker_completed_jobs: worker.jobs_completed || 0,
                worker_profile_image: worker.photo_url || null,
                specialization: worker.skills?.[0] || "General Professional",
                eta: formattedEta,
                distance: formattedDistance,
                distanceMeters: route_distance,
                duration: route_duration,
                polyline: route_polyline,
                worker: {
                    id: worker.id,
                    name: worker.full_name || "Worker",
                    photo: worker.photo_url || null,
                    phone: worker.phone_number,
                    rating: worker.rating || 4.8
                }
            };

            io.to(`user:${job.user_id}`).emit('job_accepted', acceptancePayload);
            io.to(`user:${job.user_id}`).emit('JOB_ACCEPTED', acceptancePayload);
            io.to(`user:${job.user_id}`).emit('job_status_updated', { jobId, status: 'ACCEPTED', metadata: acceptancePayload });
            io.to(`job:${jobId}`).emit('job_status_updated', { jobId, status: 'ACCEPTED', metadata: acceptancePayload });

            await this.logEvent(jobId, worker.id, 'status_change_ACCEPTED', { method: 'DIRECT_ACCEPT' });

            const workerService = require('./worker.service');
            await workerService.updateLastJobEventAt(worker.id);
            await db.query(
                "UPDATE worker_features SET last_job_event_at = CURRENT_TIMESTAMP WHERE worker_id = $1",
                [worker.id]
            );

            return { success: true, job };
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            await redis.del(`job:${jobId}:accept_lock`).catch(() => {});
            console.error("❌ [JOB_ACCEPT_FAILED] Critical Error:", error.message);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    /**
     * Submits a price negotiation offer.
     */
    async submitOffer(jobId, workerId, price) {
        const { getIO } = require('../config/socket');
        const io = getIO();
        
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) return { success: false, message: "Worker not found" };

        const jobCheck = await db.query("SELECT user_id, status FROM jobs WHERE id = $1", [jobId]);
        if (jobCheck.rowCount === 0 || !['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].includes(jobCheck.rows[0].status)) {
            return { success: false, message: "Job no longer available for negotiation" };
        }

        const expiresAt = new Date(Date.now() + 120000);
        const result = await db.query(
            `INSERT INTO job_offers (job_id, worker_id, offer_price, expires_at) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [jobId, worker.id, price, expiresAt]
        );

        const offer = result.rows[0];

        io.to(`user:${jobCheck.rows[0].user_id}`).emit('new_offer', {
            jobId,
            offerId: offer.id,
            price,
            workerId
        });

        await this.logEvent(jobId, workerId, 'status_change_OFFER_SENT', { price });
        return { success: true, offer };
    }

    /**
     * User accepts a worker's offer — Locks the job atomically.
     */
    async acceptOffer(offerId) {
        const { getIO } = require('../config/socket');
        const io = getIO();
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const offerResult = await client.query(
                "SELECT * FROM job_offers WHERE id = $1 AND status = 'PENDING' FOR UPDATE",
                [offerId]
            );
            if (offerResult.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "Offer expired or already processed" };
            }
            const offer = offerResult.rows[0];

            const jobUpdate = await client.query(
                `UPDATE jobs 
                 SET worker_id = $1, price = $2, status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3 AND status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING') 
                 RETURNING *`,
                [offer.worker_id, offer.offer_price, offer.job_id]
            );

            if (jobUpdate.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "JOB_ALREADY_TAKEN" };
            }

            const job = jobUpdate.rows[0];

            await client.query("UPDATE job_offers SET status = 'ACCEPTED' WHERE id = $1", [offerId]);
            await client.query(
                "UPDATE job_offers SET status = 'CANCELLED' WHERE job_id = $1 AND id != $2 AND status = 'PENDING'",
                [offer.job_id, offerId]
            );

            await client.query('COMMIT');

            // Redis cleanup
            await redis.del(`job:${job.id}:searching`);
            await redis.del(`job:${job.id}:dispatch_queue`);
            await redis.del(`job:${job.id}:active_offers`);
            await redis.set(`job:${job.id}:status`, 'ACCEPTED', 'EX', 3600);
            const geohash = await redis.get(`job:${job.id}:geohash`);
            if (geohash) {
                await redis.zrem(`jobs:geo:${geohash}`, job.id);
            }
            await redis.del(`job:${job.id}:geohash`);
            await redis.srem('jobs:active_set', job.id);
            const { invalidateAllHomeServicesCaches } = require('../routes/home.routes');
            await invalidateAllHomeServicesCaches().catch(() => {});

            const feedService = require('./feed.service');
            await feedService.invalidateFeedCache(job.location_lat, job.location_lng).catch(() => {});

            // Log worker response for ML training
            logWorkerResponse(offer.worker_id, job.id, 'ACCEPTED', 'via_offer').catch(() => {});
            matchingService.logDispatchEvent(job.id, 'worker_accepted', { workerId: offer.worker_id, via: 'offer' }).catch(() => {});

            // Broadcast
            const matchingService = require('./matching.service');
            const worker = await matchingService.resolveWorker(offer.worker_id);

            // Fetch directions dynamically
            const { getDirections } = require('../utils/google_maps');
            let route_polyline = '';
            let route_distance = 0;
            let route_duration = 0;
            let formattedDistance = '0 km';
            let formattedEta = '15-20 mins';

            if (worker && worker.current_lat && worker.current_lng && job.location_lat && job.location_lng) {
                try {
                    const directions = await getDirections(
                        parseFloat(worker.current_lat),
                        parseFloat(worker.current_lng),
                        parseFloat(job.location_lat),
                        parseFloat(job.location_lng)
                    );
                    route_polyline = directions.polyline;
                    route_distance = directions.distanceMeters;
                    route_duration = directions.durationSeconds;
                    
                    const km = route_distance / 1000;
                    formattedDistance = km < 1 ? `${Math.round(route_distance)}m` : `${km.toFixed(1)} km`;
                    formattedEta = `${Math.round(route_duration / 60)} mins`;

                    // Update job record with route info
                    await db.query(
                        "UPDATE jobs SET route_polyline = $1, route_distance = $2, route_duration = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
                        [route_polyline, route_distance, route_duration, job.id]
                    );

                    // Cache in Redis for throttling check
                    await redis.set(`job:${job.id}:last_directions_time`, Date.now());
                    await redis.set(`job:${job.id}:last_directions_lat`, worker.current_lat);
                    await redis.set(`job:${job.id}:last_directions_lng`, worker.current_lng);
                } catch (dirErr) {
                    console.error("⚠️ [ACCEPT_OFFER] Directions fetch failed:", dirErr.message);
                }
            }

            io.emit('job_taken', { jobId: job.id, workerId: offer.worker_id });
            
            const acceptancePayload = {
                jobId: job.id,
                job_id: job.id,
                status: "ACCEPTED",
                eta: formattedEta,
                distance: formattedDistance,
                distanceMeters: route_distance,
                duration: route_duration,
                polyline: route_polyline,
                worker: {
                    id: worker?.id,
                    name: worker?.full_name || "Worker",
                    photo: worker?.photo_url || null,
                    phone: worker?.phone_number,
                    rating: worker?.rating || 4.5
                }
            };

            io.to(`user:${job.user_id}`).emit('job_accepted', acceptancePayload);
            io.to(`user:${job.user_id}`).emit('JOB_ACCEPTED', acceptancePayload);
            io.to(`user:${job.user_id}`).emit('job_status_updated', { jobId: job.id, status: 'ACCEPTED', metadata: acceptancePayload });
            io.to(`job:${job.id}`).emit('job_status_updated', { jobId: job.id, status: 'ACCEPTED', metadata: acceptancePayload });

            await this.logEvent(job.id, offer.worker_id, 'status_change_ACCEPTED', { method: 'OFFER_ACCEPT', offerId });

            const workerService = require('./worker.service');
            await workerService.updateLastJobEventAt(offer.worker_id);
            await db.query(
                "UPDATE worker_features SET last_job_event_at = CURRENT_TIMESTAMP WHERE worker_id = $1",
                [offer.worker_id]
            );

            return { success: true, job };
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            console.error("❌ [ACCEPT-OFFER-CRITICAL-ERROR]", error.message);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async logEvent(jobId, workerId, eventType, metadata = {}) {
        try {
            const isUUID = (id) => id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            
            const safeJobId = isUUID(jobId) ? jobId : null;
            const safeWorkerId = isUUID(workerId) ? workerId : null;
            const safeUserId = (metadata.userId && isUUID(metadata.userId)) ? metadata.userId : null;

            await db.query(
                `INSERT INTO event_logs (job_id, worker_id, user_id, event_type, metadata, timestamp) 
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, CURRENT_TIMESTAMP)`,
                [safeJobId, safeWorkerId, safeUserId, eventType, JSON.stringify(metadata)]
            );
        } catch (e) {
            console.error("⚠️ [LOG ERROR] Failed to log event:", e.message);
        }
    }

    async createJob(userId, category, description, lat, lng, price, taskId = null) {
        // Prevent duplicate active requests
        const existing = await db.query(
            "SELECT id FROM jobs WHERE user_id = $1::uuid AND category = $2 AND status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')",
            [userId, category]
        );
        if (existing.rowCount > 0) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`⚠️ [DEV-AUTO-CLEANUP] Cancelling existing active job request ${existing.rows[0].id} for category ${category}`);
                await db.query(
                    "UPDATE jobs SET status = 'CANCELLED', cancellation_reason = 'AUTO_CLEANUP_DEV' WHERE id = $1",
                    [existing.rows[0].id]
                );
                // Also clean up Redis geohashes/active sets
                await redis.zrem('jobs:active', existing.rows[0].id).catch(() => {});
                await redis.srem('jobs:active_set', existing.rows[0].id).catch(() => {});
                const oldGeohash = await redis.get(`job:${existing.rows[0].id}:geohash`);
                if (oldGeohash) {
                    await redis.zrem(`jobs:geo:${oldGeohash}`, existing.rows[0].id).catch(() => {});
                    await redis.del(`job:${existing.rows[0].id}:geohash`).catch(() => {});
                }
            } else {
                throw new Error("ALREADY_EXISTS: You have an active request for this service.");
            }
        }

        const result = await db.query(
            `INSERT INTO jobs (user_id, category, description, location_lat, location_lng, price, status, task_id) 
             VALUES ($1::uuid, $2, $3, $4, $5, $6, 'OPEN', $7) 
             RETURNING *`,
            [userId, category, description, lat, lng, price, taskId]
        );
        
        const job = result.rows[0];
        await this.logEvent(job.id, null, 'status_change_CREATED', { category, price, taskId });
        await this.syncJobToRedis(job.id, lat, lng);
        
        try {
            const eventStream = require('../utils/event_stream');
            await eventStream.publish('job_posted', {
                jobId: job.id,
                category,
                lat,
                lng,
                userId
            });
        } catch (streamErr) {
            console.error("⚠️ [JOB_SERVICE] Failed to publish job_posted event:", streamErr.message);
        }

        userTrustService.recordEvent(userId, 'JOB_POSTED').catch(() => {});

        // Notify the user's home screen in real-time so the active card appears immediately
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`user:${userId}`).emit('job_posted', {
                    jobId: job.id,
                    category,
                    status: 'OPEN',
                    job
                });
            }
        } catch (socketErr) {
            console.log('[JOB_SERVICE] Socket notify skipped:', socketErr.message);
        }
        
        return job;
    }

    async syncJobToRedis(jobId, lat, lng) {
        try {
            const geoHashService = require('./geo_hash.service');
            const geohash = geoHashService.encode(lat, lng, 6);
            const oldGeohash = await redis.get(`job:${jobId}:geohash`);
            if (oldGeohash && oldGeohash !== geohash) {
                await redis.zrem(`jobs:geo:${oldGeohash}`, jobId);
            }
            await redis.geoadd(`jobs:geo:${geohash}`, lng, lat, jobId);
            await redis.set(`job:${jobId}:geohash`, geohash);
            await redis.sadd('jobs:active_set', jobId);

            await db.query(
                `UPDATE jobs SET location_cube = ll_to_earth($1, $2) WHERE id = $3 AND location_cube IS NULL`,
                [lat, lng, jobId]
            );
        } catch (e) {
            console.error("[REDIS-JOB-SYNC]", e.message);
        }
    }

    async fetchNearbyJobs(workerLat, workerLng, radiusKm = 10, workerId = null) {
        if (process.env.NODE_ENV === 'development') {
            radiusKm = 500;
        }
        let jobIds = [];
        try {
            let queryText;
            if (db.isPostgisAvailable()) {
                queryText = `
                    SELECT id FROM jobs
                    WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')
                      AND ST_DWithin(
                          ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography,
                          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                          $3 * 1000
                      )
                    ORDER BY created_at DESC`;
            } else {
                queryText = `
                    SELECT id FROM jobs
                    WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')
                      AND earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 <= $3
                    ORDER BY created_at DESC`;
            }
            const result = await db.query(queryText, [workerLat, workerLng, radiusKm]);
            jobIds = result.rows.map(r => r.id);
        } catch (pgError) {
            console.warn("[PG-GEO-FALLBACK] PostGIS query failed, falling back to Redis geohash:", pgError.message);
            try {
                const geoHashService = require('./geo_hash.service');
                const centerHash = geoHashService.encode(workerLat, workerLng, 6);
                const { lat, lng, latErr, lngErr } = geoHashService.decode(centerHash);
                const stepLat = latErr * 2;
                const stepLng = lngErr * 2;

                const neighborHashes = new Set();
                for (let i = -1; i <= 1; i++) {
                    for (let j = -1; j <= 1; j++) {
                        neighborHashes.add(geoHashService.encode(lat + i * stepLat, lng + j * stepLng, 6));
                    }
                }

                const searchPromises = Array.from(neighborHashes).map(hash =>
                    redis.geosearch(
                        `jobs:geo:${hash}`,
                        'FROMLONLAT', workerLng, workerLat,
                        'BYRADIUS', radiusKm, 'km'
                    ).catch(() => [])
                );

                const resultsList = await Promise.all(searchPromises);
                const seenJobs = new Set();
                for (const list of resultsList) {
                    for (const jid of list) {
                        if (!seenJobs.has(jid)) {
                            seenJobs.add(jid);
                            jobIds.push(jid);
                        }
                    }
                }
            } catch (fallbackError) {
                console.error("[FETCH-NEARBY-JOBS-FALLBACK] Error:", fallbackError.message);
            }
        }

        if (jobIds.length === 0) return [];

        // Filter out rejected jobs for this worker
        if (workerId) {
            const matchingService = require('./matching.service');
            const worker = await matchingService.resolveWorker(workerId);
            
            if (worker) {
                const rejected = await db.query(
                    "SELECT job_id FROM job_offers WHERE worker_id = $1 AND status = 'REJECTED'", 
                    [worker.id]
                );
                const rejectedIds = rejected.rows.map(r => r.job_id);
                jobIds = jobIds.filter(id => !rejectedIds.includes(id));

                const filtered = [];
                for (const id of jobIds) {
                    const lockValue = await redis.get(`dispatch_lock:${id}:${worker.id}`);
                    if (lockValue !== 'rejected') filtered.push(id);
                }
                jobIds = filtered;
            }
        }

        if (jobIds.length === 0) return [];

        const result = await db.query(
            `SELECT * FROM jobs 
             WHERE id = ANY($1) AND status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING') 
             ORDER BY created_at DESC`,
            [jobIds]
        );

        return result.rows;
    }

    async rejectJobOffer(jobId, workerId) {
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) throw new Error("Worker not found");

        const resolvedWorkerId = worker.id;

        // Redis lock (fast path — immediate exclusion)
        await redis.set(`dispatch_lock:${jobId}:${resolvedWorkerId}`, 'rejected', 'EX', 3600);

        // Persist to DB
        await db.query(
            "UPDATE job_offers SET status = 'REJECTED' WHERE job_id = $1 AND worker_id = $2 AND status = 'PENDING'",
            [jobId, resolvedWorkerId]
        );

        // Log worker response for ML training
        logWorkerResponse(resolvedWorkerId, jobId, 'DECLINED').catch(() => {});
        matchingService.logDispatchEvent(jobId, 'worker_declined', { workerId: resolvedWorkerId }).catch(() => {});

        return { success: true };
    }

    async fetchActiveGigs(workerId) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
        let worker;
        if (isUUID) {
            const res = await db.query("SELECT * FROM workers WHERE id = $1", [workerId]);
            worker = res.rows[0];
        } else {
            const res = await db.query("SELECT * FROM workers WHERE phone_number = $1", [workerId]);
            worker = res.rows[0];
        }

        if (!worker) {
            console.warn(`[FETCH_ACTIVE_JOBS] Worker ${workerId} not found in DB`);
            return [];
        }

        const result = await db.query(
            `SELECT j.*, u.full_name as "userName", u.avatar_url as "userPhoto", u.phone_number as "userPhone"
             FROM jobs j
             LEFT JOIN users u ON j.user_id = u.id
             WHERE j.worker_id = $1 
             AND j.status IN ('ACCEPTED', 'SCHEDULED', 'READY_TO_START', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION', 'IN_PROGRESS', 'WORK_IN_PROGRESS', 'STARTED')
             ORDER BY j.created_at DESC`,
            [worker.id]
        );
        
        return result.rows;
    }

    async cancelJobByWorker(jobId, workerId, reason, note = '') {
        const { getIO } = require('../config/socket');
        const io = getIO();
        const matchingService = require('./matching.service');
        const workerService = require('./worker.service');

        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) return { success: false, message: "Worker not found" };

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Lock the job row
            const jobCheck = await client.query("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", [jobId]);
            if (jobCheck.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "Job not found" };
            }
            
            const job = jobCheck.rows[0];
            const validStatuses = ['ACCEPTED', 'READY_TO_START', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION', 'WORK_IN_PROGRESS'];
            if (!validStatuses.includes(job.status)) {
                await client.query('ROLLBACK');
                return { success: false, message: `Cannot cancel job in ${job.status} status` };
            }

            // Reset job to REDISTRIBUTING, clear worker assignment and transition timestamps
            const updateRes = await client.query(
                `UPDATE jobs 
                 SET status = 'REDISTRIBUTING', worker_id = NULL, 
                     accepted_at = NULL, on_the_way_at = NULL, arrived_at = NULL, started_at = NULL,
                     cancellation_reason = $1, cancelled_by = 'WORKER', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2 RETURNING *`,
                [reason, jobId]
            );
            const updatedJob = updateRes.rows[0];

            // Record cancellation
            await client.query(
                `INSERT INTO job_cancellations (job_id, worker_id, reason, note) VALUES ($1, $2, $3, $4)`,
                [jobId, worker.id, reason, note]
            );

            await client.query('COMMIT');

            console.log(`[WORKER_CANCELLED] Release worker ${worker.id} from job ${jobId}. Reseting state to REDISTRIBUTING.`);

            // Redis cleanup & status update
            await matchingService.invalidateJobCaches(jobId, worker.id);
            await redis.set(`job:${jobId}:status`, 'REDISTRIBUTING');
            const { invalidateAllHomeServicesCaches } = require('../routes/home.routes');
            await invalidateAllHomeServicesCaches().catch(() => {});

            const feedService = require('./feed.service');
            await feedService.invalidateFeedCache(job.location_lat, job.location_lng).catch(() => {});

            // Log worker response for ML training
            logWorkerResponse(worker.id, jobId, 'CANCELLED', reason).catch(() => {});
            matchingService.logDispatchEvent(jobId, 'worker_cancelled', { workerId: worker.id, reason }).catch(() => {});
            
            // Re-sync to Redis active jobs GEO index so nearby workers can search/see it
            const geoHashService = require('./geo_hash.service');
            const geohash = geoHashService.encode(job.location_lat, job.location_lng, 4);
            await redis.geoadd(`jobs:geo:${geohash}`, job.location_lng, job.location_lat, jobId);
            await redis.set(`job:${jobId}:geohash`, geohash);
            await redis.sadd('jobs:active_set', jobId);

            // Publish job_cancelled event
            try {
                const eventStream = require('../utils/event_stream');
                await eventStream.publish('job_cancelled', {
                    jobId,
                    workerId: worker.id,
                    lat: job.location_lat,
                    lng: job.location_lng,
                    category: job.category
                });
            } catch (streamErr) {
                console.error("⚠️ [JOB_SERVICE] Failed to publish job_cancelled event:", streamErr.message);
            }
            await workerService.updateFatigueScore(worker.id, 'JOB_CANCELLED').catch(() => {});

            // Socket notifications
            const payload = { jobId, reason, message: "The assigned worker cancelled this job." };
            io.to(`user:${job.user_id}`).emit('WORKER_CANCELLED_JOB', payload);
            io.to(`user:${job.user_id}`).emit('WORKER_CANCELLED_GIG', payload);
            io.to(`worker:${worker.id}`).emit('WORKER_CANCELLED_JOB', payload);
            io.emit('JOB_REOPENED', { jobId, status: 'REDISTRIBUTING' });
            io.emit('JOB_REDISTRIBUTED', { jobId, status: 'REDISTRIBUTING' });

            console.log("[JOB_REOPENED]", jobId);
            console.log("[REDISPATCH_STARTED]", jobId);
            console.log("[REDISPATCH_JOB_FETCHED]", updatedJob);

            // Attempt backup activation
            const backupWorkerService = require('./backup_worker.service');
            const backupResult = await backupWorkerService.handleFailure(jobId, 'WORKER_CANCELLED', { 
                originalWorkerId: worker.id, 
                reason 
            });

            if (backupResult && backupResult.success) {
                console.log(`[DISPATCH-BACKUP] Worker cancelled. Successfully assigned backup worker: ${backupResult.backup.backup_worker_id}`);
            } else {
                console.log(`[DISPATCH] No backup available. Performing global redispatch.`);
                matchingService.broadcastJob(updatedJob);
            }

            return { success: true, message: "Job cancelled and reopened/reassigned" };
        } catch (e) {
            if (client) await client.query('ROLLBACK');
            console.error("❌ [CANCEL-BY-WORKER-ERROR]", e.message);
            return { success: false, error: e.message };
        } finally {
            if (client) client.release();
        }
    }

    async getEarningsSummary(workerId, customDate = null) {
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) return {
            today: { earnings: 0, gigs: 0 },
            week: { earnings: 0, gigs: 0 },
            month: { earnings: 0, gigs: 0 },
            year: { earnings: 0, gigs: 0 },
            random: { earnings: 0, gigs: 0 },
            totalJobs: 0,
            avgRating: 0.0
        };

        // Default to yesterday if no customDate provided
        const targetCustomDate = customDate || new Date(Date.now() - 86400000).toISOString().split('T')[0];

        const [
            todayRes, weekRes, monthRes, yearRes, totalRes, customRes,
            withdrawableRes, cashInHandRes, onlineRes, upiRes, pendingDisputedRes
        ] = await Promise.all([
            // Today (using coalesced completed_at/created_at)
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total, COUNT(*) as count FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND (COALESCE(completed_at, created_at)::date = CURRENT_DATE)`,
                [worker.id]
            ),
            // Week (last 7 days)
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total, COUNT(*) as count FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND (COALESCE(completed_at, created_at) >= NOW() - INTERVAL '7 days')`,
                [worker.id]
            ),
            // Month (last 30 days)
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total, COUNT(*) as count FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND (COALESCE(completed_at, created_at) >= NOW() - INTERVAL '30 days')`,
                [worker.id]
            ),
            // Year (last 365 days)
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total, COUNT(*) as count FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND (COALESCE(completed_at, created_at) >= NOW() - INTERVAL '365 days')`,
                [worker.id]
            ),
            // Total completed count
            db.query(
                `SELECT COUNT(*) as count FROM jobs WHERE worker_id = $1 AND status = 'COMPLETED'`,
                [worker.id]
            ),
            // Custom date query
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total, COUNT(*) as count FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND (COALESCE(completed_at, created_at)::date = $2::date)`,
                [worker.id, targetCustomDate]
            ),
            // Withdrawable Balance (Online + UPI completed jobs)
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND payment_method IN ('ONLINE', 'UPI')`,
                [worker.id]
            ),
            // Cash In-Hand (CASH completed jobs)
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND payment_method = 'CASH'`,
                [worker.id]
            ),
            // Online Completed Earnings
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND payment_method = 'ONLINE'`,
                [worker.id]
            ),
            // UPI Completed Earnings
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total FROM jobs 
                 WHERE worker_id = $1 AND status = 'COMPLETED' 
                 AND payment_method = 'UPI'`,
                [worker.id]
            ),
            // Pending/Disputed (DISPUTED or active jobs)
            db.query(
                `SELECT COALESCE(SUM(price), 0) as total FROM jobs 
                 WHERE worker_id = $1 
                 AND (status = 'DISPUTED' OR status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS', 'FORCE_ARRIVAL_PENDING_CONFIRMATION'))`,
                [worker.id]
            )
        ]);

        return {
            today: {
                earnings: parseFloat(todayRes.rows[0].total) || 0,
                gigs: parseInt(todayRes.rows[0].count) || 0
            },
            week: {
                earnings: parseFloat(weekRes.rows[0].total) || 0,
                gigs: parseInt(weekRes.rows[0].count) || 0
            },
            month: {
                earnings: parseFloat(monthRes.rows[0].total) || 0,
                gigs: parseInt(monthRes.rows[0].count) || 0
            },
            year: {
                earnings: parseFloat(yearRes.rows[0].total) || 0,
                gigs: parseInt(yearRes.rows[0].count) || 0
            },
            random: {
                earnings: parseFloat(customRes.rows[0].total) || 0,
                gigs: parseInt(customRes.rows[0].count) || 0
            },
            totalJobs: parseInt(totalRes.rows[0].count),
            avgRating: parseFloat(worker.rating) || 4.0,
            
            // Custom dynamic fields for the Earnings screen
            monthRevenue: parseFloat(monthRes.rows[0].total) || 0,
            withdrawableBalance: parseFloat(withdrawableRes.rows[0].total) || 0,
            cashInHand: parseFloat(cashInHandRes.rows[0].total) || 0,
            onlineEarnings: parseFloat(onlineRes.rows[0].total) || 0,
            upiEarnings: parseFloat(upiRes.rows[0].total) || 0,
            pendingDisputed: parseFloat(pendingDisputedRes.rows[0].total) || 0
        };
    }

    async fetchJobHistory(workerId) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
        let worker;
        if (isUUID) {
            const res = await db.query("SELECT id FROM workers WHERE id = $1", [workerId]);
            worker = res.rows[0];
        } else {
            const res = await db.query("SELECT id FROM workers WHERE phone_number = $1", [workerId]);
            worker = res.rows[0];
        }

        if (!worker) return [];

        const result = await db.query(
            `SELECT j.*, u.full_name as "userName",
                    (SELECT id FROM payments WHERE job_id = j.id AND payment_mode = 'CASH' LIMIT 1) as "cashPaymentId",
                    (SELECT payment_status FROM payments WHERE job_id = j.id AND payment_mode = 'CASH' LIMIT 1) as "cashPaymentStatus"
             FROM jobs j
             LEFT JOIN users u ON j.user_id = u.id
             WHERE j.worker_id = $1 
             AND j.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
             ORDER BY j.created_at DESC
             LIMIT 50`,
            [worker.id]
        );
        return result.rows;
    }

    async fetchPendingOffers(workerId) {
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) return [];

        const result = await db.query(
            `SELECT j.*, jo.id as offer_id, jo.status as offer_status 
             FROM job_offers jo
             JOIN jobs j ON jo.job_id = j.id
             WHERE jo.worker_id = $1 AND jo.status = 'PENDING' AND jo.expires_at > NOW()
               AND j.status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')`,
            [worker.id]
        );
        return result.rows;
    }
}

module.exports = new JobService();
