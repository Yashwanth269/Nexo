const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');
const config = require('../config/scheduled_bidding.config');
const reservationService = require('./reservation.service');
const matchingService = require('./matching.service');

class ScheduledBiddingService {
    /**
     * Determines if a job is eligible for Scheduled Bidding (scheduled_at > NOW + 3 Hours)
     */
    isScheduledBiddingEligible(scheduledAt) {
        if (!scheduledAt) return false;
        const targetDate = new Date(scheduledAt);
        if (isNaN(targetDate.getTime())) return false;

        const diffMs = targetDate.getTime() - Date.now();
        const diffHours = diffMs / (1000 * 60 * 60);
        return diffHours >= config.minScheduledHoursForBidding;
    }

    /**
     * Submit an acceptance or counter offer from a worker for a scheduled job
     */
    async submitScheduledOffer(jobId, workerPhoneOrId, offerDetails = {}) {
        const { offerPrice, proposedScheduledAt, notes, isAcceptance = true } = offerDetails;
        
        const worker = await matchingService.resolveWorker(workerPhoneOrId);
        if (!worker) {
            return { success: false, message: "WORKER_NOT_FOUND" };
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Lock and verify job
            const jobRes = await client.query(
                "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
                [jobId]
            );
            if (jobRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "JOB_NOT_FOUND" };
            }

            const job = jobRes.rows[0];
            const activeStatuses = ['OPEN', 'SCHEDULED', 'SCHEDULED_BIDDING', 'BUILD_QUEUE', 'REDISTRIBUTING'];
            if (!activeStatuses.includes(job.status)) {
                await client.query('ROLLBACK');
                return { success: false, message: "JOB_CLOSED_TO_OFFERS" };
            }

            // Verify scheduled bidding eligibility
            if (!this.isScheduledBiddingEligible(job.scheduled_at)) {
                await client.query('ROLLBACK');
                return { success: false, message: "JOB_NOT_SCHEDULED_BIDDING_ELIGIBLE" };
            }

            const finalPrice = offerPrice ? parseFloat(offerPrice) : parseFloat(job.price || 0);
            const offerStatus = (isAcceptance && (!offerPrice || offerPrice === job.price)) ? 'ACCEPTED' : 'COUNTER_OFFER';
            const proposedTime = proposedScheduledAt ? new Date(proposedScheduledAt) : null;

            // 2. Insert or Update worker offer in job_offers
            const existingOffer = await client.query(
                "SELECT id FROM job_offers WHERE job_id = $1 AND worker_id = $2",
                [jobId, worker.id]
            );

            let offerId;
            const expiresAt = job.scheduled_at ? new Date(job.scheduled_at) : new Date(Date.now() + 86400000);

            if (existingOffer.rowCount > 0) {
                offerId = existingOffer.rows[0].id;
                await client.query(
                    `UPDATE job_offers 
                     SET offer_price = $1, status = $2, proposed_scheduled_at = $3, counter_notes = $4, accepted_at = CURRENT_TIMESTAMP, expires_at = $5
                     WHERE id = $6`,
                    [finalPrice, offerStatus, proposedTime, notes || null, expiresAt, offerId]
                );
            } else {
                const insertRes = await client.query(
                    `INSERT INTO job_offers (job_id, worker_id, offer_price, status, proposed_scheduled_at, counter_notes, accepted_at, expires_at)
                     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7) RETURNING id`,
                    [jobId, worker.id, finalPrice, offerStatus, proposedTime, notes || null, expiresAt]
                );
                offerId = insertRes.rows[0].id;
            }

            // Ensure job status stays in SCHEDULED_BIDDING or SCHEDULED so dispatch can continue collecting workers
            await client.query(
                "UPDATE jobs SET status = 'SCHEDULED_BIDDING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status != 'SCHEDULED_BIDDING'",
                [jobId]
            );

            await client.query('COMMIT');

            console.log(`✅ [SCHEDULED_BIDDING] Worker ${worker.id} submitted ${offerStatus} for Job ${jobId}`);

            // Log audit history
            await this.logEvent(jobId, worker.id, `SCHEDULED_OFFER_${offerStatus}`, {
                price: finalPrice,
                proposedTime,
                notes
            });

            // Notify Customer in real-time
            let io = null;
            try { io = getIO(); } catch (_) {}
            if (io) {
                const payload = {
                    jobId,
                    offerId,
                    workerId: worker.id,
                    workerName: worker.full_name,
                    workerPhoto: worker.photo_url,
                    rating: worker.rating || 4.5,
                    completedJobs: worker.jobs_completed || 0,
                    price: finalPrice,
                    offerType: offerStatus,
                    proposedScheduledAt: proposedTime,
                    notes: notes || null,
                    timestamp: new Date().toISOString()
                };

                io.to(`user:${job.user_id}`).emit('SCHEDULED_OFFER_RECEIVED', payload);
                io.to(`job:${jobId}`).emit('SCHEDULED_OFFER_RECEIVED', payload);
                io.to(`user:${job.user_id}`).emit('scheduled_offers_updated', { jobId });
            }

            return {
                success: true,
                message: "Your offer has been submitted to the customer. You will be notified when they make a selection.",
                offerId
            };
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            console.error("❌ [SCHEDULED_BIDDING_ERROR]", error.message);
            return { success: false, error: error.message };
        } finally {
            if (client) client.release();
        }
    }

    /**
     * Fetch all interested worker offers for a scheduled job (enriched comparison list)
     */
    async fetchJobOffers(jobId, userId) {
        const jobRes = await db.query(
            "SELECT * FROM jobs WHERE id = $1",
            [jobId]
        );
        if (jobRes.rowCount === 0) {
            return { success: false, message: "Job not found" };
        }

        const job = jobRes.rows[0];

        // Fetch all interested worker offers
        const offersRes = await db.query(
            `SELECT o.*, 
                    w.full_name as "worker_name", w.phone_number as "worker_phone", w.photo_url as "worker_photo", 
                    w.rating as "worker_rating", w.jobs_completed, w.experience, w.verification_status, 
                    w.languages, w.skills, w.current_lat, w.current_lng,
                    r.overall_score as "performance_score", r.reliability_score as "reliability_score"
             FROM job_offers o
             JOIN workers w ON o.worker_id = w.id
             LEFT JOIN worker_reputation_scores r ON w.id = r.worker_id
             WHERE o.job_id = $1 AND o.status IN ('ACCEPTED', 'COUNTER_OFFER', 'SELECTED')
             ORDER BY o.accepted_at ASC`,
            [jobId]
        );

        const calculateDistance = (lat1, lon1, lat2, lon2) => {
            if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
            const R = 6371e3;
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

        const enrichedOffers = offersRes.rows.map(o => {
            let distanceStr = "3.2 km";
            let etaStr = "Approx. 15-20 mins";

            if (o.current_lat && o.current_lng && job.location_lat && job.location_lng) {
                const distMeters = calculateDistance(
                    parseFloat(o.current_lat), parseFloat(o.current_lng),
                    parseFloat(job.location_lat), parseFloat(job.location_lng)
                );
                const km = distMeters / 1000;
                distanceStr = km < 1 ? `${Math.round(distMeters)}m` : `${km.toFixed(1)} km`;
                const etaMins = Math.max(5, Math.round((km / 25) * 60));
                etaStr = `${etaMins} mins`;
            }

            return {
                offer_id: o.id,
                worker_id: o.worker_id,
                worker_name: o.worker_name || "Professional",
                worker_phone: o.worker_phone,
                worker_photo: o.worker_photo || null,
                rating: parseFloat(o.worker_rating || 4.5),
                completed_jobs: parseInt(o.jobs_completed || 0),
                distance: distanceStr,
                estimated_arrival: etaStr,
                price: parseFloat(o.offer_price || job.price),
                base_price: parseFloat(job.price || 0),
                counter_offer_price: parseFloat(o.offer_price) !== parseFloat(job.price) ? parseFloat(o.offer_price) : null,
                proposed_scheduled_at: o.proposed_scheduled_at,
                counter_notes: o.counter_notes || null,
                experience: o.experience || "3+ years",
                verification_badge: o.verification_status === 'VERIFIED',
                languages: o.languages || ["Kannada", "English", "Hindi"],
                performance_score: parseFloat(o.performance_score || 92.5),
                reliability_score: parseFloat(o.reliability_score || 95.0),
                acceptance_time: o.accepted_at || o.created_at,
                offer_status: o.status
            };
        });

        // Compute countdown to final selection deadline (scheduled_at - 1 hour)
        const scheduledTime = new Date(job.scheduled_at || Date.now() + 14400000);
        const deadlineTime = new Date(scheduledTime.getTime() - (config.finalSelectionDeadlineMinutes * 60000));
        const remainingSeconds = Math.max(0, Math.round((deadlineTime.getTime() - Date.now()) / 1000));

        return {
            success: true,
            job: {
                id: job.id,
                category: job.category,
                description: job.description,
                price: parseFloat(job.price || 0),
                scheduled_at: job.scheduled_at,
                status: job.status,
                selected_worker_id: job.worker_id
            },
            deadline_time: deadlineTime.toISOString(),
            remaining_seconds: remainingSeconds,
            offers_count: enrichedOffers.length,
            offers: enrichedOffers
        };
    }

    /**
     * Customer selects a worker from the comparison list (Atomic Reservation & Rejection)
     */
    async selectWinningWorker(jobId, userId, workerId, offerId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Lock and verify job
            const jobRes = await client.query(
                "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
                [jobId]
            );
            if (jobRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "JOB_NOT_FOUND" };
            }

            const job = jobRes.rows[0];
            if (job.user_id !== userId) {
                await client.query('ROLLBACK');
                return { success: false, message: "UNAUTHORIZED_CUSTOMER" };
            }

            if (job.worker_id && job.status === 'ACCEPTED') {
                await client.query('ROLLBACK');
                return { success: false, message: "WORKER_ALREADY_RESERVED" };
            }

            // 2. Lock winning offer
            const offerRes = await client.query(
                "SELECT * FROM job_offers WHERE id = $1 AND job_id = $2 FOR UPDATE",
                [offerId, jobId]
            );
            if (offerRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "OFFER_NOT_FOUND" };
            }

            const offer = offerRes.rows[0];

            // 3. Lock winning worker
            const workerRes = await client.query(
                "SELECT id, phone_number, full_name FROM workers WHERE id = $1 FOR UPDATE",
                [workerId]
            );
            if (workerRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "WORKER_NOT_FOUND" };
            }

            const winningWorker = workerRes.rows[0];

            // 4. Update Job: assign winning worker, price, scheduled_at, set status = ACCEPTED
            const finalScheduledAt = offer.proposed_scheduled_at || job.scheduled_at || new Date();
            const finalPrice = offer.offer_price != null ? parseFloat(offer.offer_price) : parseFloat(job.price || 0);

            await client.query(
                `UPDATE jobs 
                 SET worker_id = $1, status = 'ACCEPTED', price = $2, scheduled_at = $3, accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4`,
                [winningWorker.id, finalPrice, finalScheduledAt, jobId]
            );

            // 5. Update selected offer to 'SELECTED'
            await client.query(
                "UPDATE job_offers SET status = 'SELECTED' WHERE id = $1",
                [offerId]
            );

            // 6. Update all other offers for this job to 'NOT_SELECTED'
            const nonSelectedRes = await client.query(
                `UPDATE job_offers 
                 SET status = 'NOT_SELECTED' 
                 WHERE job_id = $1 AND id != $2 RETURNING worker_id`,
                [jobId, offerId]
            );

            // 7. Reserve time block in Worker Calendar
            await reservationService.reserveTimeBlock(
                winningWorker.id, jobId, finalScheduledAt, job.category,
                parseFloat(job.location_lat), parseFloat(job.location_lng),
                client
            );

            // 8. Update winning worker availability state
            await client.query(
                "UPDATE workers SET availability_state = 'RESERVED' WHERE id = $1",
                [winningWorker.id]
            );

            await client.query('COMMIT');

            console.log(`🏆 [SCHEDULED_SELECTION] Customer ${userId} selected Worker ${winningWorker.id} for Job ${jobId}`);

            // 9. Redis Cleanup & Sync
            await redis.set(`job:${jobId}:status`, 'ACCEPTED', 'EX', 86400);
            await redis.del(`job:${jobId}:searching`);
            await redis.del(`job:${jobId}:dispatch_queue`);

            // 10. Audit Logging
            await this.logEvent(jobId, winningWorker.id, 'SCHEDULED_CUSTOMER_SELECTED_WORKER', {
                offerId,
                finalPrice,
                finalScheduledAt
            });

            // 11. Real-time Socket.IO Broadcasts
            let io = null;
            try { io = getIO(); } catch (_) {}
            if (io) {
                // Notify Winning Worker (Celebration dialog)
                io.to(`worker:${winningWorker.phone_number}`).emit('SCHEDULED_OFFER_WON', {
                    jobId,
                    message: "Congratulations! Your offer has been accepted. Job successfully reserved.",
                    status: 'RESERVED',
                    scheduledAt: finalScheduledAt,
                    price: finalPrice
                });
                io.to(`worker:${winningWorker.id}`).emit('SCHEDULED_OFFER_WON', {
                    jobId,
                    message: "Congratulations! Your offer has been accepted. Job successfully reserved.",
                    status: 'RESERVED',
                    scheduledAt: finalScheduledAt,
                    price: finalPrice
                });

                // Notify Non-Selected Workers politely (Does NOT affect rating or rejection count)
                if (nonSelectedRes.rowCount > 0) {
                    const nonSelectedIds = nonSelectedRes.rows.map(r => r.worker_id);
                    const nonSelectedWorkers = await db.query(
                        "SELECT id, phone_number FROM workers WHERE id = ANY($1)",
                        [nonSelectedIds]
                    );
                    for (const nsw of nonSelectedWorkers.rows) {
                        const notifPayload = {
                            jobId,
                            message: "Thank you for showing interest. The customer selected another worker for this scheduled job. We're finding better opportunities for you!"
                        };
                        io.to(`worker:${nsw.phone_number}`).emit('SCHEDULED_OFFER_NOT_SELECTED', notifPayload);
                        io.to(`worker:${nsw.id}`).emit('SCHEDULED_OFFER_NOT_SELECTED', notifPayload);
                    }
                }

                // Notify Customer rooms
                const statusPayload = {
                    jobId,
                    status: 'ACCEPTED',
                    worker: {
                        id: winningWorker.id,
                        name: winningWorker.full_name,
                        phone: winningWorker.phone_number
                    }
                };
                io.to(`user:${userId}`).emit('job_status_updated', statusPayload);
                io.to(`job:${jobId}`).emit('job_status_updated', statusPayload);
            }

            return {
                success: true,
                message: "Worker selected and schedule reserved successfully!",
                worker: winningWorker
            };
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            console.error("❌ [SCHEDULED_SELECTION_ERROR]", error.message);
            return { success: false, error: error.message };
        } finally {
            if (client) client.release();
        }
    }

    /**
     * Periodic engine to check scheduled jobs deadlines, send reminders, and execute fallback logic
     */
    async processScheduledRemindersAndDeadlines() {
        try {
            // Find active scheduled jobs with start time in future
            const jobsRes = await db.query(
                `SELECT j.* 
                 FROM jobs j
                 WHERE j.scheduled_at > NOW() 
                 AND j.status IN ('SCHEDULED', 'SCHEDULED_BIDDING', 'OPEN')
                 AND j.worker_id IS NULL`
            );

            if (jobsRes.rowCount === 0) return;

            let io = null;
            try { io = getIO(); } catch (_) {}

            for (const job of jobsRes.rows) {
                const scheduledTime = new Date(job.scheduled_at).getTime();
                const diffMinutes = (scheduledTime - Date.now()) / (1000 * 60);

                // Check if any worker has accepted or counter-offered
                const offersCountRes = await db.query(
                    "SELECT COUNT(*) FROM job_offers WHERE job_id = $1 AND status IN ('ACCEPTED', 'COUNTER_OFFER')",
                    [job.id]
                );
                const hasOffers = parseInt(offersCountRes.rows[0].count || 0) > 0;

                if (!hasOffers) continue;

                // 1. Mandatory Selection Window (60 minutes before service)
                if (diffMinutes <= config.finalSelectionDeadlineMinutes && diffMinutes > config.fallbackDeadlineMinutes) {
                    if (io) {
                        io.to(`user:${job.user_id}`).emit('MANDATORY_SELECTION_REQUIRED', {
                            jobId: job.id,
                            message: "Action Required: Please select a worker before 1 hour of service start time.",
                            deadlineMinutes: Math.round(diffMinutes)
                        });
                    }
                }

                // 2. Fallback execution (45 minutes before service if customer hasn't selected)
                if (diffMinutes <= config.fallbackDeadlineMinutes) {
                    console.warn(`⚠️ [SCHEDULED_FALLBACK] Customer missed selection window for Job ${job.id}. Executing strategy: ${config.fallbackStrategy}`);
                    await this.executeFallbackStrategy(job);
                }
            }
        } catch (e) {
            console.error("❌ [SCHEDULED_REMINDER_ENGINE_ERROR]", e.message);
        }
    }

    /**
     * Executes automatic fallback strategy when customer misses deadline
     */
    async executeFallbackStrategy(job) {
        if (config.fallbackStrategy === 'AUTO_ASSIGN_HIGHEST_RANKED') {
            // Find highest-ranked offer
            const bestOfferRes = await db.query(
                `SELECT o.*, w.rating 
                 FROM job_offers o
                 JOIN workers w ON o.worker_id = w.id
                 WHERE o.job_id = $1 AND o.status IN ('ACCEPTED', 'COUNTER_OFFER')
                 ORDER BY w.rating DESC, o.accepted_at ASC LIMIT 1`,
                [job.id]
            );

            if (bestOfferRes.rowCount > 0) {
                const bestOffer = bestOfferRes.rows[0];
                console.log(`🤖 [AUTO_FALLBACK] Auto-assigning highest ranked worker ${bestOffer.worker_id} for Job ${job.id}`);
                await this.selectWinningWorker(job.id, job.user_id, bestOffer.worker_id, bestOffer.id);
            } else {
                await db.query("UPDATE jobs SET status = 'EXPIRED' WHERE id = $1", [job.id]);
            }
        } else if (config.fallbackStrategy === 'CANCEL_BOOKING') {
            await db.query("UPDATE jobs SET status = 'CANCELLED', cancellation_reason = 'CUSTOMER_SELECTION_TIMEOUT' WHERE id = $1", [job.id]);
        }
    }

    async logEvent(jobId, workerId, eventType, metadata = {}) {
        try {
            await db.query(
                `INSERT INTO event_logs (job_id, worker_id, event_type, metadata, timestamp) 
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [jobId, workerId, eventType, JSON.stringify(metadata)]
            );
        } catch (e) {
            console.error("[SCHEDULED_BIDDING_LOG_ERROR]", e.message);
        }
    }
}

module.exports = new ScheduledBiddingService();
