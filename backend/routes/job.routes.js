const express = require('express');
const router = express.Router();
const { z } = require('zod');
const jobService = require('../services/job.service');
const matchingService = require('../services/matching.service');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { jobCreateLimiter } = require('../middleware/rate-limits');

// Validation Schemas
const acceptSchema = z.object({
    jobId: z.string().uuid(),
    workerId: z.string().uuid()
});

const createJobSchema = z.object({
    userId: z.string().uuid(),
    serviceType: z.string(),
    taskId: z.string().nullable().optional(),
    description: z.string(),
    lat: z.number(),
    lng: z.number(),
    price: z.number()
});

// Get Ongoing Job for User
router.get('/:userId/ongoing', async (req, res) => {
    try {
        const { userId } = req.params;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
        let targetUserId = userId;

        if (!isUUID) {
            const uRes = await db.query("SELECT id FROM users WHERE phone_number = $1 OR phone = $1", [userId]);
            if (uRes.rowCount > 0) {
                targetUserId = uRes.rows[0].id;
            } else {
                return res.json({ success: false, message: "User not found", jobs: [] });
            }
        }
        
        // Fetch all active jobs for this user with worker details
        console.log(`🔍 [JOB-FETCH] Fetching ongoing jobs for User: ${targetUserId}`);
        const result = await db.query(
            `SELECT j.*, w.full_name as "workerName", w.photo_url as "workerPhoto", w.phone_number as "workerPhone", w.rating as "workerRating", w.jobs_completed as "workerJobsCompleted", w.current_lat as "worker_lat", w.current_lng as "worker_lng"
             FROM jobs j
             LEFT JOIN workers w ON j.worker_id = w.id
             WHERE j.user_id = $1::uuid 
             AND j.status IN ('OPEN', 'REQUESTED', 'ACCEPTED', 'RESERVED', 'CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION', 'WORK_IN_PROGRESS', 'WORK_STARTED') 
             ORDER BY j.created_at DESC`,
            [targetUserId]
        );

        if (result.rowCount > 0) {
            const jobs = result.rows.map(job => {
                // Map worker details to a nested object for frontend consistency
                if (job.worker_id) {
                    job.worker = {
                        id: job.worker_id,
                        name: job.workerName || "Worker",
                        photo: job.workerPhoto || null,
                        phone: job.workerPhone,
                        rating: job.workerRating || 4.5,
                        jobs_completed: job.workerJobsCompleted || 0
                    };
                }

                if (job.route_distance !== null && job.route_distance !== undefined) {
                    const km = job.route_distance / 1000;
                    job.distance = km < 1 ? `${Math.round(job.route_distance)}m` : `${km.toFixed(1)} km`;
                }
                if (job.route_duration !== null && job.route_duration !== undefined) {
                    job.eta = `${Math.round(job.route_duration / 60)} mins`;
                }

                if (['OPEN', 'REQUESTED', 'REDISTRIBUTING', 'REASSIGNING'].includes(job.status)) {
                    job.searchState = job.search_state_stage ? parseInt(job.search_state_stage) : 1;
                    job.searchRadius = job.search_radius_km ? Math.round(parseFloat(job.search_radius_km)) : 3;
                }
                return job;
            });

            console.log(`✅ [JOB-FETCH] Found ${jobs.length} active jobs`);
            res.json({ success: true, jobs, job: jobs[0] });
        } else {
            res.json({ success: false, message: "No ongoing job found", jobs: [] });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// Create Job & Trigger Dispatch
router.post('/create', jobCreateLimiter, async (req, res) => {
    try {
        const validated = createJobSchema.parse(req.body);
        
        // Check user restriction status
        const uCheck = await db.query("SELECT status FROM users WHERE id = $1::uuid", [validated.userId]);
        if (uCheck.rowCount > 0 && uCheck.rows[0].status === 'RESTRICTED') {
            return res.status(403).json({ 
                success: false, 
                error: "ACCOUNT_RESTRICTED", 
                message: "Your account is temporarily restricted from booking new jobs due to repeated late cancellations." 
            });
        }

        const job = await jobService.createJob(
            validated.userId,
            validated.serviceType,
            validated.description,
            validated.lat,
            validated.lng,
            validated.price,
            validated.taskId
        );
        
        // Immediate Async Dispatch
        matchingService.broadcastJob(job);
        
        res.json({ success: true, job });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Atomic Job Acceptance
router.post('/accept', async (req, res) => {
    try {
        const { jobId, workerId } = req.body;
        
        // Resolve worker UUID if phone number passed
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
        let resolvedWorkerId = workerId;
        if (!isUUID) {
            const wRes = await db.query("SELECT id FROM workers WHERE phone_number = $1", [workerId]);
            if (wRes.rowCount > 0) {
                resolvedWorkerId = wRes.rows[0].id;
            }
        }

        // Check for active pending offer in staged dispatch queue
        const offerRes = await db.query(
            "SELECT id FROM job_offers WHERE job_id = $1 AND worker_id = $2 AND status = 'PENDING' LIMIT 1",
            [jobId, resolvedWorkerId]
        );

        let result;
        if (offerRes.rowCount > 0) {
            const dispatchQueue = require('../services/dispatch_queue.service');
            result = await dispatchQueue.acceptOfferAtomically(offerRes.rows[0].id, workerId);
        } else {
            result = await jobService.acceptJob(jobId, workerId);
        }

        if (!result.success) return res.status(409).json(result);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Worker submits a negotiation offer
router.post('/negotiate', async (req, res) => {
    try {
        const { jobId, workerId, price } = req.body;
        const result = await jobService.submitOffer(jobId, workerId, price);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// User accepts a worker's offer
router.post('/offer/accept', async (req, res) => {
    try {
        const { offerId } = req.body;
        const result = await jobService.acceptOffer(offerId);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Send Proactive Status Update
router.post('/:id/status-update', async (req, res) => {
    try {
        const jobId = req.params.id;
        const { workerId, type, delay } = req.body;
        const result = await jobService.sendStatusUpdate(jobId, workerId, type, delay);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Confirm Arrival (Geo-validated)
router.post('/:id/arrive', async (req, res) => {
    try {
        const jobId = req.params.id;
        const { workerId, lat, lng } = req.body;
        const result = await jobService.confirmArrival(jobId, workerId, lat, lng);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start Work (DEPRECATED - Use /status instead)
router.patch('/start', async (req, res) => {
    try {
        const { jobId, workerId } = req.body;
        const result = await jobService.startJob(jobId, workerId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Job Status (New State Machine)
router.patch('/:id/status', async (req, res) => {
    const executionService = require('../services/execution.service');
    try {
        const jobId = req.params.id;
        const { workerId, newStatus, lat, lng, isMocked, force } = req.body;
        const result = await executionService.transitionStatus(jobId, workerId, newStatus, { lat, lng, isMocked, force });
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Customer Confirms Arrival
router.post('/:id/customer-confirm-arrival', async (req, res) => {
    const executionService = require('../services/execution.service');
    try {
        const jobId = req.params.id;
        const { userId } = req.body;
        
        // Fetch job and verify user
        const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount === 0) return res.status(404).json({ success: false, error: "Job not found" });
        
        const job = jobRes.rows[0];
        if (job.user_id !== userId) return res.status(403).json({ success: false, error: "Unauthorized user" });
        if (job.status !== 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
            return res.status(400).json({ success: false, error: `Cannot confirm arrival from status: ${job.status}` });
        }

        // Perform transition to ARRIVED using execution service
        const result = await executionService.transitionStatus(jobId, job.worker_id, 'ARRIVED', { customerConfirmed: true, lat: job.location_lat, lng: job.location_lng });
        
        if (result.success) {
            console.log(`[CUSTOMER_CONFIRMATION_SENT] Customer ${userId} confirmed arrival for job ${jobId}`);
            // Emit socket event to worker and user
            const { getIO } = require('../config/socket');
            const io = getIO();
            io.to(`job:${jobId}`).emit('CUSTOMER_CONFIRMED_ARRIVAL', { jobId });
            io.to(`worker:${job.worker_id}`).emit('CUSTOMER_CONFIRMED_ARRIVAL', { jobId });
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Customer Updates Address
router.post('/:id/update-address', async (req, res) => {
    const redis = require('../config/redis');
    try {
        const jobId = req.params.id;
        const { userId, lat, lng, address } = req.body;

        // Fetch job
        const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount === 0) return res.status(404).json({ success: false, error: "Job not found" });
        
        const job = jobRes.rows[0];
        if (job.user_id !== userId) return res.status(403).json({ success: false, error: "Unauthorized user" });

        // Update jobs location in DB
        await db.query(
            "UPDATE jobs SET location_lat = $1, location_lng = $2, address = $3, status = 'ON_THE_WAY', updated_at = CURRENT_TIMESTAMP WHERE id = $4",
            [lat, lng, address || job.address, jobId]
        );

        // Update Redis status cache
        await redis.set(`job:${jobId}:status`, 'ON_THE_WAY', 'EX', 3600);

        // Log Event
        await db.query(
            "INSERT INTO event_logs (job_id, worker_id, event_type, metadata) VALUES ($1, $2, $3, $4)",
            [jobId, job.worker_id, 'ADDRESS_UPDATED', JSON.stringify({ userId, lat, lng, address, prevLat: job.location_lat, prevLng: job.location_lng })]
        );

        console.log(`[ADDRESS_UPDATED] Job ${jobId} destination updated to: (${lat}, ${lng})`);

        // Emit Socket events
        const { getIO } = require('../config/socket');
        const io = getIO();
        const updatePayload = {
            jobId,
            destination_lat: lat,
            destination_lng: lng,
            address: address || job.address
        };

        io.to(`user:${userId}`).emit('DESTINATION_UPDATED', updatePayload);
        io.to(`job:${jobId}`).emit('DESTINATION_UPDATED', updatePayload);
        io.to(`worker:${job.worker_id}`).emit('DESTINATION_UPDATED', updatePayload);

        res.json({ success: true, message: "Address updated successfully and worker notified." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/location/sync', async (req, res) => {
    try {
        const { jobId, lat, lng } = req.body;
        if (!jobId || !lat || !lng) return res.status(400).json({ error: "Missing params" });

        const jobRes = await db.query("SELECT worker_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount > 0 && jobRes.rows[0].worker_id) {
            const executionService = require('../services/execution.service');
            await executionService.syncWorkerLocation(jobRes.rows[0].worker_id, parseFloat(lat), parseFloat(lng));
        } else {
            // Fallback broadcast
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`job:${jobId}`).emit('worker_location_update', { lat, lng });
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Complete Work (DEPRECATED - Use /status instead)
router.patch('/complete', async (req, res) => {
    try {
        const { jobId, workerId } = req.body;
        const result = await jobService.completeJob(jobId, workerId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Drop & Reassign Job
router.post('/:id/drop', async (req, res) => {
    try {
        const jobId = req.params.id;
        const { workerId, reason } = req.body;
        
        const result = await jobService.dropJob(jobId, workerId, reason);
        
        if (result.success) {
            // Trigger Re-dispatch immediately
            matchingService.broadcastJob(result.job);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cancel Job (Mid-execution by worker)
router.post('/:id/cancel-by-worker', async (req, res) => {
    try {
        const jobId = req.params.id;
        const { workerId, reason, note } = req.body;
        const result = await jobService.cancelJobByWorker(jobId, workerId, reason, note);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Worker Emergency Reassignment
router.post('/:id/worker-reassign', async (req, res) => {
    let client;
    try {
        const jobId = req.params.id;
        const { workerId, reason, note } = req.body;
        
        if (!workerId || !reason) {
            return res.status(400).json({ success: false, error: "workerId and reason are required" });
        }
        
        // Resolve worker
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
        let worker;
        if (isUUID) {
            const wRes = await db.query("SELECT * FROM workers WHERE id = $1", [workerId]);
            worker = wRes.rows[0];
        } else {
            const wRes = await db.query("SELECT * FROM workers WHERE phone_number = $1", [workerId]);
            worker = wRes.rows[0];
        }
        
        if (!worker) {
            return res.status(404).json({ success: false, error: "Worker not found" });
        }
        
        client = await db.pool.connect();
        await client.query('BEGIN');
        
        // Lock and fetch job
        const jobRes = await client.query("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", [jobId]);
        if (jobRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Job not found" });
        }
        const job = jobRes.rows[0];
        
        // Can reassign only before work starts
        const blockedStatuses = ['WORK_IN_PROGRESS', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
        if (blockedStatuses.includes(job.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: "REASSIGN_BLOCKED", message: `Cannot reassign job in ${job.status} status` });
        }
        
        const statusBeforeReassign = job.status;
        // Reset job status to OPEN, clear worker details and active tracking timestamps
        const updateRes = await client.query(
            `UPDATE jobs 
             SET status = 'OPEN', worker_id = NULL, 
                 accepted_at = NULL, on_the_way_at = NULL, arrived_at = NULL, started_at = NULL, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1 RETURNING *`,
            [jobId]
        );
        const updatedJob = updateRes.rows[0];

        // Apply reliability impact to worker (reduce reliability score by 0.1)
        const currentReliability = parseFloat(worker.reliability_score || 1.0);
        const newReliability = Math.max(0.0, currentReliability - 0.1);
        await client.query("UPDATE workers SET reliability_score = $1 WHERE id = $2", [newReliability, worker.id]);
        
        // Log worker reliability event
        await client.query(
            `INSERT INTO worker_reliability_events (worker_id, job_id, event_type, points_delta, current_score, metadata)
             VALUES ($1, $2, 'EMERGENCY_REASSIGN', -0.1, $3, $4)`,
             [worker.id, jobId, newReliability, JSON.stringify({ reason, note, status_at_reassign: statusBeforeReassign })]
        );
        
        // Log to cancellation/reassignment audit table
        await client.query(
            `INSERT INTO job_cancellation_audit (job_id, cancelled_by, cancelled_by_id, status_at_cancellation, reason, notes, penalty_applied)
             VALUES ($1, 'WORKER', $2, $3, $4, $5, TRUE)`,
             [jobId, worker.id, statusBeforeReassign, reason, note || '']
        );
        
        await client.query('COMMIT');

        // Redis cache status reset
        const redis = require('../config/redis');
        await matchingService.invalidateJobCaches(jobId, worker.id);
        await redis.set(`job:${jobId}:status`, 'OPEN');
        // Re-sync back to Redis active jobs GEO index
        await redis.geoadd('jobs:active', job.location_lng, job.location_lat, jobId);
        
        // Emit Socket events
        const { getIO } = require('../config/socket');
        const io = getIO();
        const reassignPayload = {
            jobId,
            job_id: jobId,
            message: "Worker had an emergency. Finding another worker.",
            reason
        };
        
        // Notify Customer in room
        io.to(`user:${job.user_id}`).emit('WORKER_EMERGENCY_REASSIGN', reassignPayload);
        io.to(`user:${job.user_id}`).emit('WORKER_REASSIGNED_GIG', reassignPayload);
        io.emit('JOB_REOPENED', { jobId, status: 'OPEN' });
        io.emit('JOB_REDISTRIBUTED', { jobId, status: 'OPEN' });
        
        // Also log event
        const jobService = require('../services/job.service');
        await jobService.logEvent(jobId, worker.id, 'WORKER_EMERGENCY_REASSIGN', { reason, note });
        
        console.log(`[ASSIGNMENT_RELEASED] Worker ${worker.id} emergency reassigned Job ${jobId}. Reseting state to OPEN.`);
        console.log(`[EMERGENCY_REASON_SELECTED] Emergency reason selected: ${reason}`);
        console.log(`[REDISTRIBUTION_STARTED] Triggering priority matching re-dispatch for Job ${jobId}`);
        
        // Trigger redispatch automatically
        console.log("[JOB_REOPENED]", jobId);
        console.log("[REDISPATCH_STARTED]", jobId);
        console.log("[REDISPATCH_JOB_FETCHED]", updatedJob);
        matchingService.broadcastJob(updatedJob);
        
        res.json({ success: true, message: "Emergency reassignment triggered." });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Worker Reassign Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
});

// Cancel Job (Mid-execution)
router.post('/:id/cancel', async (req, res) => {
    try {
        const jobId = req.params.id;
        const { workerId, reason } = req.body;
        const result = await jobService.cancelJob(jobId, workerId, reason);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Earnings Summary
router.get('/worker/earnings/summary/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const { date } = req.query;
        const summary = await jobService.getEarningsSummary(phone, date);
        res.json({
            success: true,
            summary
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Job History
router.get('/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await db.query(
            `SELECT j.*, w.full_name as "workerName", w.phone_number as "workerPhone", w.photo_url as "workerPhoto", w.skills as "workerSkills",
                    (EXISTS (SELECT 1 FROM ratings r WHERE r.job_id = j.id AND r.from_id = j.user_id)) as "isRated"
             FROM jobs j
             LEFT JOIN workers w ON j.worker_id = w.id
             WHERE j.user_id = $1::uuid 
             ORDER BY j.created_at DESC`,
            [userId]
        );
        res.json({ success: true, jobs: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});



/**
 * @route GET /api/jobs/nearby
 * @desc Pull-based discovery for active long-lived jobs
 */
router.get('/nearby', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const radius = parseFloat(req.query.radius || (process.env.NODE_ENV === 'development' ? '500' : '10'));
        const workerId = req.query.workerId;

        if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "Location required" });

        const jobs = await jobService.fetchNearbyJobs(lat, lng, radius, workerId);
        res.json({ success: true, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Active Gigs for a worker
router.get('/active/:workerId', async (req, res) => {
    try {
        const { workerId } = req.params;
        console.log(`[ROUTE] Fetching active gigs for: ${workerId}`);
        const jobs = await jobService.fetchActiveGigs(workerId);
        res.json({ success: true, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Lightweight Active Gigs (Optimized for instant loading)
const handleActiveJobsLight = async (req, res) => {
    const startTime = Date.now();
    try {
        const workerId = req.params.workerId || req.query.workerId;
        if (!workerId) {
            return res.status(400).json({ success: false, error: "workerId is required" });
        }
        
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
        let worker;
        if (isUUID) {
            const wRes = await db.query("SELECT id, current_lat, current_lng FROM workers WHERE id = $1", [workerId]);
            worker = wRes.rows[0];
        } else {
            const wRes = await db.query("SELECT id, current_lat, current_lng FROM workers WHERE phone_number = $1", [workerId]);
            worker = wRes.rows[0];
        }

        if (!worker) {
            console.warn(`[FETCH_LIGHT_ACTIVE] Worker ${workerId} not found`);
            return res.json({ success: true, jobs: [] });
        }

        const queryTimeStart = Date.now();
        const result = await db.query(
            `SELECT j.id as "job_id", j.id, j.status, u.full_name as "customer_name", u.full_name as "userName",
                    u.avatar_url as "userPhoto", j.category, j.scheduled_at as "scheduled_time", j.price,
                    j.location_lat, j.location_lng, j.accepted_at, j.on_the_way_at, j.arrived_at, j.started_at, j.completed_at
             FROM jobs j
             LEFT JOIN users u ON j.user_id = u.id
             WHERE j.worker_id = $1 
             AND j.status IN ('ACCEPTED', 'SCHEDULED', 'READY_TO_START', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION', 'IN_PROGRESS', 'WORK_IN_PROGRESS', 'STARTED')
             ORDER BY j.created_at DESC`,
            [worker.id]
        );
        const queryTime = Date.now() - queryTimeStart;
        const totalTime = Date.now() - startTime;
        
        // Helper to calculate Haversine distance
        const calculateDistance = (lat1, lon1, lat2, lon2) => {
            if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
            const R = 6371e3; // meters
            const phi1 = lat1 * Math.PI / 180;
            const phi2 = lat2 * Math.PI / 180;
            const deltaPhi = (lat2 - lat1) * Math.PI / 180;
            const deltaLambda = (lon2 - lon1) * Math.PI / 180;

            const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                      Math.cos(phi1) * Math.cos(phi2) *
                      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        const enrichedJobs = result.rows.map(job => {
            let distanceStr = "0m";
            let etaStr = "1 min";

            if (job.route_distance !== null && job.route_distance !== undefined) {
                const km = job.route_distance / 1000;
                distanceStr = km < 1 ? `${Math.round(job.route_distance)}m` : `${km.toFixed(1)} km`;
                if (job.route_duration !== null && job.route_duration !== undefined) {
                    etaStr = `${Math.round(job.route_duration / 60)} mins`;
                }
            } else if (worker.current_lat && worker.current_lng && job.location_lat && job.location_lng) {
                const distanceMeters = calculateDistance(
                    parseFloat(worker.current_lat), parseFloat(worker.current_lng),
                    parseFloat(job.location_lat), parseFloat(job.location_lng)
                );
                const distanceKm = distanceMeters / 1000;
                distanceStr = distanceKm < 1 
                    ? `${Math.round(distanceMeters)}m` 
                    : `${distanceKm.toFixed(1)} km`;

                const speedKmh = 25; // average urban speed
                const etaMins = Math.max(1, Math.round((distanceKm / speedKmh) * 60));
                etaStr = `${etaMins} mins`;
            }

            return {
                ...job,
                distance: distanceStr,
                eta: etaStr
            };
        });

        console.log(`⚡ [ACTIVE_GIGS_LOAD_TIME] ${totalTime}ms | [DB_QUERY_TIME]: ${queryTime}ms | [API_RESPONSE_TIME]: ${totalTime}ms`);
        res.json({ success: true, jobs: enrichedJobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

router.get('/worker/active-jobs-light', handleActiveJobsLight);
router.get('/worker/active-jobs-light/:workerId', handleActiveJobsLight);


// Reject Job Offer (Permanent exclusion)
router.post('/reject', async (req, res) => {
    try {
        const { jobId, workerId } = req.body;
        
        // Resolve worker UUID if phone number passed
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
        let resolvedWorkerId = workerId;
        if (!isUUID) {
            const wRes = await db.query("SELECT id FROM workers WHERE phone_number = $1", [workerId]);
            if (wRes.rowCount > 0) {
                resolvedWorkerId = wRes.rows[0].id;
            }
        }

        const offerRes = await db.query(
            "SELECT id FROM job_offers WHERE job_id = $1 AND worker_id = $2 AND status = 'PENDING' LIMIT 1",
            [jobId, resolvedWorkerId]
        );

        let result;
        if (offerRes.rowCount > 0) {
            const dispatchQueue = require('../services/dispatch_queue.service');
            result = await dispatchQueue.declineOffer(offerRes.rows[0].id, resolvedWorkerId);
        } else {
            result = await jobService.rejectJobOffer(jobId, workerId);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get pending offers for a worker
router.get('/offers/pending/:workerId', async (req, res) => {
    try {
        const { workerId } = req.params;
        const jobs = await jobService.fetchPendingOffers(workerId);
        res.json({ success: true, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get job history for a worker
router.get('/worker/history/:workerId', async (req, res) => {
    try {
        const { workerId } = req.params;
        const jobs = await jobService.fetchJobHistory(workerId);
        res.json({ success: true, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});




// Get Single Job Details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `SELECT j.*, u.full_name as "userName", u.avatar_url as "userPhoto"
             FROM jobs j
             LEFT JOIN users u ON j.user_id = u.id
             WHERE j.id = $1::uuid`,
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Job not found" });
        res.json({ success: true, job: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Single Job Details (User matched)
router.get('/:userId/:jobId', async (req, res) => {
    try {
        const { userId, jobId } = req.params;
        
        // 1. Fetch Job with Worker Details
        const jobResult = await db.query(
            `SELECT j.*, 
                    w.full_name as "workerName", w.photo_url as "workerPhoto", 
                    w.phone_number as "workerPhone", w.rating as "workerRating", 
                    w.jobs_completed as "workerJobsCompleted",
                    w.current_lat as "worker_lat", w.current_lng as "worker_lng"
             FROM jobs j 
             LEFT JOIN workers w ON j.worker_id = w.id
             WHERE j.id = $1::uuid AND j.user_id = $2::uuid`, 
            [jobId, userId]
        );
        
        if (jobResult.rowCount === 0) return res.status(404).json({ success: false, message: "Job not found" });
        
        const job = jobResult.rows[0];

        // 2. Fetch Timeline from event_logs
        const timelineResult = await db.query(
            `SELECT event_type as title, created_at as timestamp 
             FROM event_logs 
             WHERE job_id = $1::uuid 
             ORDER BY created_at ASC`,
            [jobId]
        );

        // Map status names to human-readable titles for timeline
        const timeline = timelineResult.rows.map(log => {
            let title = log.title;
            // Handle both status_change_ prefix and legacy job_accepted style
            title = title.replace('status_change_', '').replace('job_', '');
            title = title.replace(/_/g, ' ');
            
            // Title Case conversion
            title = title.split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ');

            return {
                title,
                timestamp: log.timestamp
            };
        });

        // 3. Construct nested worker object if exists
        if (job.worker_id) {
            job.worker = {
                id: job.worker_id,
                name: job.workerName || "Professional",
                photoUrl: job.workerPhoto,
                phoneNumber: job.workerPhone,
                rating: job.workerRating || 4.5,
                reviews: job.workerJobsCompleted || 0
            };
        }

        job.timeline = timeline;

        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update/Cancel Job by User
router.patch('/:userId/:jobId', async (req, res) => {
    try {
        let { userId, jobId } = req.params;
        const updates = req.body;

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);
        if (!isUUID || jobId === 'null') {
            // Auto-resolve active job ID for user
            const activeRes = await db.query(
                "SELECT id FROM jobs WHERE user_id = $1::uuid AND status IN ('OPEN', 'REQUESTED', 'ACCEPTED', 'RESERVED', 'CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION') ORDER BY created_at DESC LIMIT 1",
                [userId]
            );
            if (activeRes.rowCount > 0) {
                jobId = activeRes.rows[0].id;
                console.log(`[JOB-ID-RESOLVED] Resolved invalid/null jobId to active job ${jobId} for user ${userId}`);
            } else {
                return res.status(400).json({ success: false, message: "No active job found to update" });
            }
        }

        // Validation for user cancellation
        if (updates.status === 'CANCELLED') {
            console.log(`[USER_CANCEL_REQUEST] User ${userId} requested cancellation for Job ${jobId}`);
            
            const statusCheck = await db.query("SELECT status, worker_id FROM jobs WHERE id = $1::uuid", [jobId]);
            if (statusCheck.rowCount === 0) {
                return res.status(404).json({ success: false, error: "Job not found" });
            }
            const currentStatus = statusCheck.rows[0].status;
            
            // Block cancellation entirely if work is in progress or finished
            const blockedStatuses = ['WORK_IN_PROGRESS', 'IN_PROGRESS', 'COMPLETED'];
            if (blockedStatuses.includes(currentStatus)) {
                return res.status(400).json({ 
                    success: false, 
                    error: "CANCEL_BLOCKED", 
                    message: "Cannot cancel job while work is in progress or completed." 
                });
            }

            const lateStatuses = ['ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION'];
            if (lateStatuses.includes(currentStatus)) {
                const reason = req.body.reason || updates.reason;
                const notes = req.body.notes || req.body.note || updates.notes;
                
                if (!reason) {
                    return res.status(400).json({ 
                        success: false, 
                        error: "LATE_CANCEL_REASON_REQUIRED", 
                        message: "A cancellation reason is required because the journey has started." 
                    });
                }

                console.log(`[LATE_CANCELLATION] User ${userId} is performing a late cancellation for Job ${jobId}. Reason: ${reason}`);

                // Retrieve current user reliability score
                const uRes = await db.query("SELECT reliability_score FROM users WHERE id = $1", [userId]);
                const currentScore = uRes.rows[0]?.reliability_score ?? 100;
                
                // Penalize user: -5 points
                const newScore = Math.max(0, currentScore - 5);
                await db.query("UPDATE users SET reliability_score = $1 WHERE id = $2", [newScore, userId]);
                console.log(`[USER_RELIABILITY_REDUCED] User ${userId} reliability score updated from ${currentScore} to ${newScore}`);

                // Log user reliability event
                await db.query(
                    `INSERT INTO user_reliability_events (user_id, job_id, event_type, points_delta, current_score, metadata)
                     VALUES ($1, $2, 'LATE_CANCELLATION', -5, $3, $4)`,
                    [userId, jobId, newScore, JSON.stringify({ reason, notes, status_at_cancellation: currentStatus })]
                );

                // Log to job cancellation audit table
                await db.query(
                    `INSERT INTO job_cancellation_audit (job_id, cancelled_by, cancelled_by_id, status_at_cancellation, reason, notes, penalty_applied)
                     VALUES ($1, 'USER', $2, $3, $4, $5, TRUE)`,
                    [jobId, userId, currentStatus, reason, notes || '']
                );

                // Check for repeated late cancellations: 3 in 30 days
                const countRes = await db.query(
                    `SELECT COUNT(*) FROM user_reliability_events 
                     WHERE user_id = $1 AND event_type = 'LATE_CANCELLATION' 
                     AND created_at > NOW() - INTERVAL '30 days'`,
                    [userId]
                );
                const lateCancelCount = parseInt(countRes.rows[0].count);
                if (lateCancelCount >= 3) {
                    await db.query("UPDATE users SET status = 'RESTRICTED' WHERE id = $1", [userId]);
                    console.log(`[ACCOUNT_RESTRICTION_TRIGGERED] User ${userId} status restricted due to ${lateCancelCount} late cancellations in 30 days.`);
                }

                // Setup DB columns to write during normal update execution
                updates.cancelled_by = 'USER';
                updates.cancelled_at = new Date();
                updates.cancellation_reason = reason;
                
                // Clear fields not in the jobs table
                delete updates.reason;
                delete updates.notes;
                delete updates.note;
            } else {
                console.log(`[CANCEL_ALLOWED] Job: ${jobId} is in status ${currentStatus}. Proceeding with free cancellation.`);
                updates.cancelled_by = 'USER';
                updates.cancelled_at = new Date();
            }
        }
        
        // Strict whitelist of allowed fields to prevent SQL injection
        const allowedFields = ['status', 'description', 'budget', 'cancelled_by', 'cancelled_at', 'cancellation_reason'];
        
        // Build dynamic update query using only allowed fields
        const safeUpdates = {};
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                safeUpdates[field] = updates[field];
            }
        }
        
        const fields = Object.keys(safeUpdates);
        if (fields.length === 0) return res.status(400).json({ success: false, error: "No valid fields to update" });
        
        const setClause = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
        const values = fields.map(f => safeUpdates[f]);
        
        const query = `
            UPDATE jobs 
            SET ${setClause} 
            WHERE id = $1::uuid AND user_id = $2::uuid 
            RETURNING *
        `;
        
        const result = await db.query(query, [jobId, userId, ...values]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: "Job not found or access denied" });
        }

        const job = result.rows[0];

        // Notify workers if user cancels
        if (updates.status === 'CANCELLED') {
            const { getIO } = require('../config/socket');
            const io = getIO();
            const jobService = require('../services/job.service');

            let workerPhone = null;
            if (job.worker_id) {
                const workerResult = await db.query("SELECT phone_number FROM workers WHERE id = $1", [job.worker_id]);
                workerPhone = workerResult.rows[0]?.phone_number;
            }
            
            const cancelPayload = { 
                jobId: job.id, 
                job_id: job.id, 
                message: job.cancellation_reason ? `Customer cancelled: ${job.cancellation_reason}` : "Customer cancelled the job before journey started.",
                reason: job.cancellation_reason || null
            };

            // Emit to targeted rooms
            if (job.worker_id) {
                io.to(`worker:${job.worker_id}`).emit('USER_CANCELLED_JOB', cancelPayload);
                io.to(`worker:${job.worker_id}`).emit('job_cancelled_by_user', cancelPayload);
                if (job.cancellation_reason) {
                    io.to(`worker:${job.worker_id}`).emit('USER_LATE_CANCELLED_JOB', cancelPayload);
                }
                console.log(`[WORKER_NOTIFIED] Worker ${job.worker_id} notified in worker UUID room.`);
            }
            if (workerPhone) {
                io.to(`worker:${workerPhone}`).emit('USER_CANCELLED_JOB', cancelPayload);
                io.to(`worker:${workerPhone}`).emit('job_cancelled_by_user', cancelPayload);
                if (job.cancellation_reason) {
                    io.to(`worker:${workerPhone}`).emit('USER_LATE_CANCELLED_JOB', cancelPayload);
                }
                console.log(`[WORKER_NOTIFIED] Worker notified in phone room: ${workerPhone}.`);
            }
            io.to(`user:${job.user_id}`).emit('USER_CANCELLED_JOB', cancelPayload);
            io.to(`user:${job.user_id}`).emit('USER_RELIABILITY_UPDATED', {
                userId: job.user_id,
                reliabilityScore: job.cancellation_reason ? (await db.query("SELECT reliability_score FROM users WHERE id = $1", [job.user_id])).rows[0]?.reliability_score : 100
            });

            // Global fallback broadcast
            io.emit('job_cancelled_by_user', { jobId: job.id });
            
            // Clean up corresponding job offers in DB
            await db.query(
                "UPDATE job_offers SET status = 'CANCELLED' WHERE job_id = $1 AND status = 'PENDING'",
                [job.id]
            ).catch(err => console.error("⚠️ [DB-CLEANUP] Failed to cancel job offers:", err.message));

            // Clean up Redis active jobs list, geo location index and status cache
            const redis = require('../config/redis');
            await redis.zrem('jobs:active', job.id).catch(() => {});
            await redis.set(`job:${job.id}:status`, 'CANCELLED').catch(() => {});
            
            const geohash = await redis.get(`job:${job.id}:geohash`).catch(() => null);
            if (geohash) {
                await redis.zrem(`jobs:geo:${geohash}`, job.id).catch(() => {});
            }
            await redis.del(`job:${job.id}:geohash`).catch(() => {});
            await redis.srem('jobs:active_set', job.id).catch(() => {});

            // Log to event_logs via JobService for consistency
            await jobService.logEvent(job.id, job.worker_id, 'status_change_CANCELLED', { 
                reason: 'USER_CANCELLED',
                userId: job.user_id,
                cancellation_reason: job.cancellation_reason
            });
            
            console.log(`[ACTIVE_JOB_CLEARED] Worker active job cleared in real-time.`);
            console.log(`[JOB_MARKED_UNSUCCESSFUL] Job: ${job.id} marked as unsuccessful history.`);
            console.log(`🚫 [USER_CANCELLED] Job: ${job.id}`);
        }
        
        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save Completion Proof Photo
router.post('/:id/completion-photo', async (req, res) => {
    try {
        const jobId = req.params.id;
        const { photoUrl } = req.body;
        
        await db.query(
            "UPDATE jobs SET completion_photo = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
            [photoUrl, jobId]
        );
        
        // Update the completed job post's photo in the social feed
        try {
            const feedService = require('../services/feed.service');
            await feedService.createOrUpdateCompletedPost(jobId);
        } catch (feedErr) {
            console.error("⚠️ [JOBS_ROUTES] Failed to update completed job post with photo:", feedErr.message);
        }
        
        res.json({ success: true, message: "Completion proof photo updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
