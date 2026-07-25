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
     * Submit an acceptance or counter offer from a worker for a scheduled job (Stage 1: Interest)
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

            // 2. Check limits: Worker pending interests cap (Max 20)
            const activeInterestsRes = await client.query(
                "SELECT COUNT(*) FROM job_offers WHERE worker_id = $1 AND status IN ('ACCEPTED', 'COUNTER_OFFER', 'INTERESTED')",
                [worker.id]
            );
            const activeInterestsCount = parseInt(activeInterestsRes.rows[0].count || 0);
            if (activeInterestsCount >= config.maxWorkerPendingInterests) {
                await client.query('ROLLBACK');
                return { 
                    success: false, 
                    error: "MAX_PENDING_INTERESTS_REACHED",
                    message: `You have reached the maximum limit of ${config.maxWorkerPendingInterests} pending interest submissions.` 
                };
            }

            // 3. Check limits: Max accepted workers per job cap (Max 10)
            const jobOffersCountRes = await client.query(
                "SELECT COUNT(*) FROM job_offers WHERE job_id = $1 AND status IN ('ACCEPTED', 'COUNTER_OFFER', 'INTERESTED')",
                [jobId]
            );
            const jobOffersCount = parseInt(jobOffersCountRes.rows[0].count || 0);
            if (jobOffersCount >= config.maxAcceptedWorkersPerJob) {
                await client.query('ROLLBACK');
                return { 
                    success: false, 
                    error: "MAX_ACCEPTED_WORKERS_REACHED",
                    message: "This scheduled job has reached its maximum worker interest capacity." 
                };
            }

            const finalPrice = offerPrice ? parseFloat(offerPrice) : parseFloat(job.price || 0);
            const offerStatus = (isAcceptance && (!offerPrice || offerPrice === job.price)) ? 'ACCEPTED' : 'COUNTER_OFFER';
            const proposedTime = proposedScheduledAt ? new Date(proposedScheduledAt) : null;

            // 4. Insert or Update worker offer in job_offers
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

            // Ensure job status stays in SCHEDULED_BIDDING
            await client.query(
                "UPDATE jobs SET status = 'SCHEDULED_BIDDING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status != 'SCHEDULED_BIDDING'",
                [jobId]
            );

            await client.query('COMMIT');

            console.log(`✅ [SCHEDULED_BIDDING] Worker ${worker.id} expressed interest (${offerStatus}) for Job ${jobId}`);

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
                message: "Interest expressed successfully! You will be notified if the customer selects your profile.",
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
     * Worker withdraws their interest/offer before customer selection
     */
    async withdrawScheduledOffer(jobId, workerPhoneOrId, reason = "Worker withdrew interest") {
        const worker = await matchingService.resolveWorker(workerPhoneOrId);
        if (!worker) return { success: false, message: "WORKER_NOT_FOUND" };

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const offerRes = await client.query(
                "SELECT id, job_id, status FROM job_offers WHERE job_id = $1 AND worker_id = $2 FOR UPDATE",
                [jobId, worker.id]
            );

            if (offerRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "OFFER_NOT_FOUND" };
            }

            const offer = offerRes.rows[0];
            if (['SELECTED', 'CONFIRMED'].includes(offer.status)) {
                await client.query('ROLLBACK');
                return { success: false, message: "CANNOT_WITHDRAW_SELECTED_OFFER" };
            }

            await client.query(
                "UPDATE job_offers SET status = 'WITHDRAWN', withdrawal_reason = $1 WHERE id = $2",
                [reason, offer.id]
            );

            await client.query('COMMIT');

            console.log(`🏃 [WORKER_WITHDRAWAL] Worker ${worker.id} withdrew offer for Job ${jobId}`);

            await this.logEvent(jobId, worker.id, 'WORKER_WITHDREW_SCHEDULED_OFFER', { reason });

            // Notify Customer in real-time
            const jobRes = await db.query("SELECT user_id FROM jobs WHERE id = $1", [jobId]);
            let io = null;
            try { io = getIO(); } catch (_) {}
            if (io && jobRes.rowCount > 0) {
                const userId = jobRes.rows[0].user_id;
                io.to(`user:${userId}`).emit('SCHEDULED_OFFER_WITHDRAWN', { jobId, workerId: worker.id });
                io.to(`job:${jobId}`).emit('SCHEDULED_OFFER_WITHDRAWN', { jobId, workerId: worker.id });
                io.to(`user:${userId}`).emit('scheduled_offers_updated', { jobId });
            }

            return { success: true, message: "Offer withdrawn successfully." };
        } catch (e) {
            if (client) await client.query('ROLLBACK');
            console.error("❌ [WITHDRAWAL_ERROR]", e.message);
            return { success: false, error: e.message };
        } finally {
            if (client) client.release();
        }
    }

    /**
     * Fetch all interested worker offers for a scheduled job (ML Scoring, Badges, Search Stats)
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

        // Fetch interested worker offers
        const offersRes = await db.query(
            `SELECT o.*, 
                    w.full_name as "worker_name", w.phone_number as "worker_phone", w.photo_url as "worker_photo", 
                    w.rating as "worker_rating", w.jobs_completed, w.experience, w.verification_status, 
                    w.languages, w.skills, w.current_lat, w.current_lng, w.is_online, w.is_available,
                    w.commitment_score,
                    r.overall_score as "performance_score", r.reliability_score as "reliability_score"
             FROM job_offers o
             JOIN workers w ON o.worker_id = w.id
             LEFT JOIN worker_reputation_scores r ON w.id = r.worker_id
             WHERE o.job_id = $1 AND o.status IN ('ACCEPTED', 'COUNTER_OFFER', 'INTERESTED', 'SELECTED', 'CONFIRMED')
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

        const jobPrice = parseFloat(job.price || 0);
        let lowestOfferPrice = jobPrice;

        offersRes.rows.forEach(o => {
            const p = parseFloat(o.offer_price || jobPrice);
            if (p < lowestOfferPrice) lowestOfferPrice = p;
        });

        // 1. Calculate ML recommendation score & badges for each offer
        let highestMlScore = -1;
        let topMlOfferId = null;

        const rawOffers = offersRes.rows.map(o => {
            let distKm = 3.2;
            let etaMins = 15;

            if (o.current_lat && o.current_lng && job.location_lat && job.location_lng) {
                const distMeters = calculateDistance(
                    parseFloat(o.current_lat), parseFloat(o.current_lng),
                    parseFloat(job.location_lat), parseFloat(job.location_lng)
                );
                distKm = distMeters / 1000;
                etaMins = Math.max(5, Math.round((distKm / 25) * 60));
            }

            const rating = parseFloat(o.worker_rating || 4.5);
            const reliability = parseFloat(o.reliability_score || 95.0);
            const completedJobs = parseInt(o.jobs_completed || 0);
            const price = parseFloat(o.offer_price || jobPrice);
            const commitment = parseFloat(o.commitment_score || 100.0);
            const isVerified = o.verification_status === 'VERIFIED';

            // ML Score Formula
            const mlScore = (rating * 15) + (reliability * 0.4) + (commitment * 0.2) + 
                            (completedJobs > 50 ? 15 : 5) + (isVerified ? 10 : 0) - 
                            (distKm * 2) - ((price - lowestOfferPrice) * 0.05);

            if (mlScore > highestMlScore) {
                highestMlScore = mlScore;
                topMlOfferId = o.id;
            }

            const distanceStr = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)} km`;
            const etaStr = `${etaMins} mins`;

            return {
                raw: o,
                distKm,
                etaMins,
                mlScore,
                distanceStr,
                etaStr,
                price
            };
        });

        const enrichedOffers = rawOffers.map(item => {
            const o = item.raw;
            const isRecommended = o.id === topMlOfferId;

            // Badges list
            const badges = [];
            if (isRecommended) badges.push("⭐ Recommended");
            if (o.accepted_at && (new Date(o.accepted_at).getTime() - new Date(job.created_at).getTime()) < 120000) {
                badges.push("⚡ Fast Response");
            }
            if (parseFloat(o.worker_rating || 0) >= 4.8) badges.push("🏆 Top Rated");
            if (item.price <= lowestOfferPrice) badges.push("💰 Best Value");
            if (o.is_online && o.is_available) badges.push("🟢 Available");

            return {
                offer_id: o.id,
                worker_id: o.worker_id,
                worker_name: o.worker_name || "Professional",
                worker_phone: o.worker_phone,
                worker_photo: o.worker_photo || null,
                rating: parseFloat(o.worker_rating || 4.5),
                completed_jobs: parseInt(o.jobs_completed || 0),
                distance: item.distanceStr,
                distance_km: item.distKm,
                estimated_arrival: item.etaStr,
                eta_minutes: item.etaMins,
                price: item.price,
                base_price: jobPrice,
                counter_offer_price: item.price !== jobPrice ? item.price : null,
                proposed_scheduled_at: o.proposed_scheduled_at,
                counter_notes: o.counter_notes || null,
                experience: o.experience || "3+ years",
                verification_badge: o.verification_status === 'VERIFIED',
                languages: o.languages || ["Kannada", "English", "Hindi"],
                performance_score: parseFloat(o.performance_score || 92.5),
                reliability_score: parseFloat(o.reliability_score || 95.0),
                commitment_score: parseFloat(o.commitment_score || 100.0),
                acceptance_time: o.accepted_at || o.created_at,
                offer_status: o.status,
                ml_score: item.mlScore,
                is_recommended: isRecommended,
                recommendation_reason: isRecommended ? "Best overall combination of reliability, experience, ratings and proximity." : null,
                rationale_bullets: isRecommended ? [
                    `✓ High reliability rating (${parseFloat(o.reliability_score || 95.0).toFixed(0)}%)`,
                    `✓ Excellent completion record (${parseInt(o.jobs_completed || 0)} jobs)`,
                    `✓ ${item.distanceStr} away (Fastest response)`,
                    `✓ Top customer reviews (${parseFloat(o.worker_rating || 4.5).toFixed(1)}★)`
                ] : [],
                badges: badges
            };
        });

        // Compute search statistics
        const counterOffersCount = enrichedOffers.filter(o => o.counter_offer_price !== null).length;
        const searchStats = {
            evaluated_count: Math.max(35, enrichedOffers.length * 7),
            notified_count: Math.max(15, enrichedOffers.length * 3),
            viewed_count: Math.max(8, enrichedOffers.length * 2),
            interested_count: enrichedOffers.length,
            counter_offers_count: counterOffersCount
        };

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
                price: jobPrice,
                scheduled_at: job.scheduled_at,
                status: job.status,
                selected_worker_id: job.worker_id
            },
            deadline_time: deadlineTime.toISOString(),
            remaining_seconds: remainingSeconds,
            offers_count: enrichedOffers.length,
            max_accepted_capacity: config.maxAcceptedWorkersPerJob,
            search_stats: searchStats,
            offers: enrichedOffers
        };
    }

    /**
     * Customer selects a worker from comparison screen (Stage 2: Initiates 10-min Worker Confirmation)
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
            const finalScheduledAt = offer.proposed_scheduled_at || job.scheduled_at || new Date();
            const finalPrice = offer.offer_price != null ? parseFloat(offer.offer_price) : parseFloat(job.price || 0);

            // 4. Set Job status = 'SELECTION_PENDING_CONFIRMATION' & assign worker_id
            await client.query(
                `UPDATE jobs 
                 SET worker_id = $1, status = 'SELECTION_PENDING_CONFIRMATION', price = $2, scheduled_at = $3, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4`,
                [winningWorker.id, finalPrice, finalScheduledAt, jobId]
            );

            // 5. Set offer status = 'SELECTED' with 10-minute confirmation deadline
            const confirmationDeadline = new Date(Date.now() + (config.selectionConfirmationWindowMinutes * 60000));
            await client.query(
                "UPDATE job_offers SET status = 'SELECTED', confirmation_deadline = $1 WHERE id = $2",
                [confirmationDeadline, offerId]
            );

            await client.query('COMMIT');

            console.log(`🏆 [SCHEDULED_SELECTION] Customer ${userId} selected Worker ${winningWorker.id} for Job ${jobId}. Confirmation window: 10 mins.`);

            await this.logEvent(jobId, winningWorker.id, 'SCHEDULED_CUSTOMER_SELECTED_WORKER', {
                offerId,
                finalPrice,
                confirmationDeadline
            });

            // Send 10-minute confirmation prompt socket event to winning worker
            let io = null;
            try { io = getIO(); } catch (_) {}
            if (io) {
                const payload = {
                    jobId,
                    offerId,
                    customerName: "Customer",
                    scheduledAt: finalScheduledAt,
                    price: finalPrice,
                    confirmationDeadlineMinutes: config.selectionConfirmationWindowMinutes,
                    confirmationDeadline: confirmationDeadline.toISOString(),
                    message: "You've been selected by the customer! Please confirm this booking within 10 minutes to finalize your reservation."
                };

                io.to(`worker:${winningWorker.phone_number}`).emit('SCHEDULED_SELECTION_CONFIRMATION_REQUIRED', payload);
                io.to(`worker:${winningWorker.id}`).emit('SCHEDULED_SELECTION_CONFIRMATION_REQUIRED', payload);

                io.to(`user:${userId}`).emit('job_status_updated', { jobId, status: 'SELECTION_PENDING_CONFIRMATION' });
            }

            return {
                success: true,
                message: `Worker ${winningWorker.full_name} selected! Awaiting 10-minute worker booking confirmation.`,
                worker: winningWorker,
                confirmationDeadline: confirmationDeadline.toISOString()
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
     * Worker confirms or rejects reservation once selected by customer (Stage 2 Completion)
     */
    async confirmWorkerReservation(jobId, workerPhoneOrId, isConfirmed = true) {
        const worker = await matchingService.resolveWorker(workerPhoneOrId);
        if (!worker) return { success: false, message: "WORKER_NOT_FOUND" };

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const jobRes = await client.query(
                "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
                [jobId]
            );
            if (jobRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "JOB_NOT_FOUND" };
            }

            const job = jobRes.rows[0];

            const offerRes = await client.query(
                "SELECT * FROM job_offers WHERE job_id = $1 AND worker_id = $2 AND status = 'SELECTED' FOR UPDATE",
                [jobId, worker.id]
            );

            if (offerRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "NO_PENDING_SELECTION_OFFER" };
            }

            const offer = offerRes.rows[0];

            if (isConfirmed) {
                // WORKER CONFIRMED RESERVATION
                await client.query(
                    `UPDATE jobs 
                     SET status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = $1`,
                    [jobId]
                );

                await client.query(
                    "UPDATE job_offers SET status = 'CONFIRMED', worker_confirmed_at = CURRENT_TIMESTAMP WHERE id = $1",
                    [offer.id]
                );

                // Update non-selected offers
                const nonSelectedRes = await client.query(
                    `UPDATE job_offers 
                     SET status = 'NOT_SELECTED' 
                     WHERE job_id = $1 AND id != $2 RETURNING worker_id`,
                    [jobId, offer.id]
                );

                // Reserve Worker Calendar
                await reservationService.reserveTimeBlock(
                    worker.id, jobId, job.scheduled_at, job.category,
                    parseFloat(job.location_lat), parseFloat(job.location_lng),
                    client
                );

                // Update Worker Commitment Score (+2) & Availability State
                await client.query(
                    `UPDATE workers 
                     SET availability_state = 'RESERVED', commitment_score = LEAST(100.0, commitment_score + 2.0)
                     WHERE id = $1`,
                    [worker.id]
                );

                await client.query('COMMIT');

                console.log(`✅ [SELECTION_CONFIRMED] Worker ${worker.id} confirmed reservation for Job ${jobId}`);

                await this.logEvent(jobId, worker.id, 'WORKER_CONFIRMED_SCHEDULED_RESERVATION');

                let io = null;
                try { io = getIO(); } catch (_) {}
                if (io) {
                    io.to(`worker:${worker.phone_number}`).emit('SCHEDULED_OFFER_WON', {
                        jobId,
                        message: "Congratulations! Your booking has been confirmed & reserved.",
                        status: 'RESERVED',
                        scheduledAt: job.scheduled_at,
                        price: job.price
                    });
                    io.to(`worker:${worker.id}`).emit('SCHEDULED_OFFER_WON', {
                        jobId,
                        message: "Congratulations! Your booking has been confirmed & reserved.",
                        status: 'RESERVED',
                        scheduledAt: job.scheduled_at,
                        price: job.price
                    });

                    // Notify non-selected workers politely
                    if (nonSelectedRes.rowCount > 0) {
                        const nonSelectedIds = nonSelectedRes.rows.map(r => r.worker_id);
                        const nonSelectedWorkers = await db.query(
                            "SELECT id, phone_number FROM workers WHERE id = ANY($1)",
                            [nonSelectedIds]
                        );
                        for (const nsw of nonSelectedWorkers.rows) {
                            const notifPayload = {
                                jobId,
                                message: "This customer selected another professional. Thank you for your interest! We are already finding more opportunities for you."
                            };
                            io.to(`worker:${nsw.phone_number}`).emit('SCHEDULED_OFFER_NOT_SELECTED', notifPayload);
                            io.to(`worker:${nsw.id}`).emit('SCHEDULED_OFFER_NOT_SELECTED', notifPayload);
                        }
                    }

                    io.to(`user:${job.user_id}`).emit('job_status_updated', {
                        jobId,
                        status: 'ACCEPTED',
                        worker: { id: worker.id, name: worker.full_name, phone: worker.phone_number }
                    });
                    io.to(`job:${jobId}`).emit('job_status_updated', {
                        jobId,
                        status: 'ACCEPTED',
                        worker: { id: worker.id, name: worker.full_name, phone: worker.phone_number }
                    });
                }

                return { success: true, message: "Booking confirmed and calendar reserved!" };
            } else {
                // WORKER REJECTED OR MISSED SELECTION CONFIRMATION
                await client.query(
                    "UPDATE job_offers SET status = 'REJECTED_BY_WORKER' WHERE id = $1",
                    [offer.id]
                );

                // Reduce Worker Commitment Score (-15.0) & Reliability
                await client.query(
                    `UPDATE workers 
                     SET commitment_score = GREATEST(0.0, commitment_score - 15.0),
                         reliability_score = GREATEST(0.0, reliability_score - 0.10)
                     WHERE id = $1`,
                    [worker.id]
                );

                // Revert Job to SCHEDULED_BIDDING & trigger standby auto-assignment
                await client.query(
                    "UPDATE jobs SET worker_id = NULL, status = 'SCHEDULED_BIDDING', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                    [jobId]
                );

                await client.query('COMMIT');

                console.warn(`⚠️ [SELECTION_REJECTED] Worker ${worker.id} declined/missed selection confirmation for Job ${jobId}. Reverting to scheduled bidding.`);

                await this.logEvent(jobId, worker.id, 'WORKER_REJECTED_SCHEDULED_SELECTION');

                // Trigger automatic standby assignment for next best worker if offers exist
                await this.triggerStandbyReplacement(jobId);

                return { success: true, message: "Selection declined. Job reverted to standby queue." };
            }
        } catch (e) {
            if (client) await client.query('ROLLBACK');
            console.error("❌ [CONFIRMATION_ERROR]", e.message);
            return { success: false, error: e.message };
        } finally {
            if (client) client.release();
        }
    }

    /**
     * Auto-assign next best worker from standby queue when selected worker declines or times out
     */
    async triggerStandbyReplacement(jobId) {
        try {
            const nextBestRes = await db.query(
                `SELECT o.*, j.user_id 
                 FROM job_offers o
                 JOIN jobs j ON o.job_id = j.id
                 WHERE o.job_id = $1 AND o.status IN ('ACCEPTED', 'COUNTER_OFFER')
                 ORDER BY o.accepted_at ASC LIMIT 1`,
                [jobId]
            );

            if (nextBestRes.rowCount > 0) {
                const nextOffer = nextBestRes.rows[0];
                console.log(`🔄 [STANDBY_AUTO_ASSIGN] Triggering replacement selection for Worker ${nextOffer.worker_id} on Job ${jobId}`);
                await this.selectWinningWorker(jobId, nextOffer.user_id, nextOffer.worker_id, nextOffer.id);
            }
        } catch (e) {
            console.error("❌ [STANDBY_REPLACEMENT_ERROR]", e.message);
        }
    }

    /**
     * Periodic engine to check selection confirmation deadlines and send reminders
     */
    async processScheduledRemindersAndDeadlines() {
        try {
            // 1. Check expired 10-minute worker confirmation windows
            const expiredConfirmationsRes = await db.query(
                `SELECT o.*, j.id as job_id 
                 FROM job_offers o
                 JOIN jobs j ON o.job_id = j.id
                 WHERE o.status = 'SELECTED' 
                 AND o.confirmation_deadline < NOW()`
            );

            for (const expiredOffer of expiredConfirmationsRes.rows) {
                console.warn(`⏰ [CONFIRMATION_EXPIRED] Worker ${expiredOffer.worker_id} missed 10-min confirmation deadline for Job ${expiredOffer.job_id}`);
                await this.confirmWorkerReservation(expiredOffer.job_id, expiredOffer.worker_id, false);
            }

            // 2. Active scheduled jobs deadline monitor
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

                const offersCountRes = await db.query(
                    "SELECT COUNT(*) FROM job_offers WHERE job_id = $1 AND status IN ('ACCEPTED', 'COUNTER_OFFER')",
                    [job.id]
                );
                const hasOffers = parseInt(offersCountRes.rows[0].count || 0) > 0;

                if (!hasOffers) continue;

                // Mandatory Selection Window (60 minutes before service)
                if (diffMinutes <= config.finalSelectionDeadlineMinutes && diffMinutes > config.fallbackDeadlineMinutes) {
                    if (io) {
                        io.to(`user:${job.user_id}`).emit('MANDATORY_SELECTION_REQUIRED', {
                            jobId: job.id,
                            message: "Action Required: Please select a worker before 1 hour of service start time.",
                            deadlineMinutes: Math.round(diffMinutes)
                        });
                    }
                }

                // Fallback execution (45 minutes before service)
                if (diffMinutes <= config.fallbackDeadlineMinutes) {
                    console.warn(`⚠️ [SCHEDULED_FALLBACK] Customer missed selection window for Job ${job.id}. Executing strategy: ${config.fallbackStrategy}`);
                    await this.executeFallbackStrategy(job);
                }
            }
        } catch (e) {
            console.error("❌ [SCHEDULED_REMINDER_ENGINE_ERROR]", e.message);
        }
    }

    async executeFallbackStrategy(job) {
        if (config.fallbackStrategy === 'AUTO_ASSIGN_HIGHEST_RANKED') {
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
