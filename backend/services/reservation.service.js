const db = require('../config/db');
const redis = require('../config/redis');
const dispatchConfig = require('../config/dispatch.config');
const { getIO } = require('../config/socket');

class ReservationService {
    /**
     * Reservoirs a time block in worker calendar for an accepted job
     */
    async reserveTimeBlock(workerId, jobId, scheduledStart, category, lat, lng, txClient = null) {
        console.log(`📅 [RESERVATION] Creating time block for Worker ${workerId} on Job ${jobId}`);
        const start = new Date(scheduledStart);

        const client = txClient || await db.pool.connect();
        try {
            if (!txClient) await client.query('BEGIN');

            // 1. Concurrency Calendar Locking (Point 2)
            // Acquire row-level write locks on the worker's calendar entries for this day to prevent concurrent double-bookings
            const startOfDay = new Date(start);
            startOfDay.setHours(0,0,0,0);
            const endOfDay = new Date(start);
            endOfDay.setHours(23,59,59,999);

            await client.query(`
                SELECT id FROM worker_calendar 
                WHERE worker_id = $1 
                  AND scheduled_start BETWEEN $2 AND $3
                FOR UPDATE
            `, [workerId, startOfDay, endOfDay]);

            // 2. Predict Job Duration using ML helper predictions (Point 3)
            const optService = require('./marketplace_optimization.service');
            const durationRes = optService.predictJobDuration(category, 'default');
            const duration = durationRes.estimatedDurationMins;

            // 3. Calculate dynamic travel and buffers using Routing Engine calculations (Point 1)
            const travelTime = await this.calculateTravelTimeMinutes(workerId, lat, lng);
            const bufferBefore = dispatchConfig.reservations.categoryBuffers[category] || dispatchConfig.reservations.defaultBufferMinutes;
            const bufferAfter = bufferBefore;

            // Check final conflict within transaction locks
            const conflict = await this._checkLockedConflict(client, workerId, start, duration, category, travelTime, bufferBefore, bufferAfter);
            if (conflict.conflict) {
                throw new Error(`CONCURRENT_BOOKING_CONFLICT: ${conflict.reason}`);
            }

            // Insert into calendar
            const insertQuery = `
                INSERT INTO worker_calendar (
                    worker_id, booking_id, service_category, scheduled_start, 
                    estimated_duration_minutes, travel_time_before_minutes, travel_time_after_minutes,
                    buffer_before_minutes, buffer_after_minutes, location_lat, location_lng, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'CONFIRMED')
                RETURNING id`;
            const params = [
                workerId, jobId, category, start, duration,
                travelTime, travelTime, bufferBefore, bufferAfter, lat, lng
            ];
            const calendarRes = await client.query(insertQuery, params);

            // Update worker state to RESERVED
            await client.query(
                `UPDATE workers 
                 SET availability_state = CASE 
                     WHEN is_online = true AND availability_state != 'BUSY' THEN 'RESERVED'::varchar
                     ELSE availability_state
                 END
                 WHERE id = $1`,
                [workerId]
            );

            if (!txClient) await client.query('COMMIT');
            console.log(`✅ [RESERVATION-SUCCESS] Time block reserved. ID: ${calendarRes.rows[0].id}`);
            return { success: true, calendarId: calendarRes.rows[0].id };
        } catch (err) {
            if (!txClient) await client.query('ROLLBACK');
            console.error('❌ [RESERVATION-ERROR]', err.message);
            return { success: false, error: err.message };
        } finally {
            if (!txClient) client.release();
        }
    }

    async _checkLockedConflict(client, workerId, start, durationMinutes, category, travelTime, bufferBefore, bufferAfter) {
        const totalJobTime = durationMinutes + travelTime * 2 + bufferBefore + bufferAfter;
        const startAdjusted = new Date(start.getTime() - (travelTime + bufferBefore) * 60000);
        const endAdjusted = new Date(start.getTime() + (durationMinutes + travelTime + bufferAfter) * 60000);

        const queryText = `
            SELECT * FROM worker_calendar
            WHERE worker_id = $1 
              AND status = 'CONFIRMED'
              AND (
                (scheduled_start - (travel_time_before_minutes + buffer_before_minutes) * INTERVAL '1 minute' < $3)
                AND
                (scheduled_start + (estimated_duration_minutes + travel_time_after_minutes + buffer_after_minutes) * INTERVAL '1 minute' > $2)
              )`;
        
        const conflictRes = await client.query(queryText, [workerId, startAdjusted, endAdjusted]);
        if (conflictRes.rowCount > 0) {
            return { conflict: true, reason: 'OVERLAPPING_RESERVATION' };
        }
        return { conflict: false };
    }

    /**
     * Checks if a worker has an overlapping booking or exceeds daily limits
     */
    async checkCalendarConflict(workerId, scheduledStart, durationMinutes, category, lat, lng) {
        const start = new Date(scheduledStart);
        const travelTime = await this.calculateTravelTimeMinutes(workerId, lat, lng);
        const bufferBefore = dispatchConfig.reservations.categoryBuffers[category] || dispatchConfig.reservations.defaultBufferMinutes;
        const bufferAfter = bufferBefore;

        const totalJobTime = durationMinutes + travelTime * 2 + bufferBefore + bufferAfter;
        const startAdjusted = new Date(start.getTime() - (travelTime + bufferBefore) * 60000);
        const endAdjusted = new Date(start.getTime() + (durationMinutes + travelTime + bufferAfter) * 60000);

        // Check for overlapping blocks
        const queryText = `
            SELECT * FROM worker_calendar
            WHERE worker_id = $1 
              AND status = 'CONFIRMED'
              AND (
                (scheduled_start - (travel_time_before_minutes + buffer_before_minutes) * INTERVAL '1 minute' < $3)
                AND
                (scheduled_start + (estimated_duration_minutes + travel_time_after_minutes + buffer_after_minutes) * INTERVAL '1 minute' > $2)
              )`;
        
        const conflictRes = await db.query(queryText, [workerId, startAdjusted, endAdjusted]);
        if (conflictRes.rowCount > 0) {
            return { conflict: true, reason: 'OVERLAPPING_RESERVATION' };
        }

        // Check daily work hour limits (burnout prevention)
        const dailyStats = await this.getDailyWorkStats(workerId, start);
        if (dailyStats.totalHours + (totalJobTime / 60.0) > dispatchConfig.reservations.maxDailyWorkingHours) {
            return { conflict: true, reason: 'EXCEEDS_DAILY_WORKING_HOURS' };
        }

        return { conflict: false };
    }

    /**
     * Smart Gap Filling: checks if an instant job fits before the next scheduled reservation
     */
    async evaluateGapFilling(workerId, durationMinutes, jobLat, jobLng) {
        const queryText = `
            SELECT scheduled_start, travel_time_before_minutes, buffer_before_minutes, location_lat, location_lng
            FROM worker_calendar
            WHERE worker_id = $1 AND status = 'CONFIRMED' AND scheduled_start > NOW()
            ORDER BY scheduled_start ASC LIMIT 1`;
        
        const nextRes = await db.query(queryText, [workerId]);
        if (nextRes.rowCount === 0) return true;

        const nextBooking = nextRes.rows[0];
        const nextStart = new Date(nextBooking.scheduled_start);

        const travelToNextBooking = await this.calculateTravelBetweenPoints(
            jobLat, jobLng, parseFloat(nextBooking.location_lat), parseFloat(nextBooking.location_lng)
        );

        const timeNeededMs = (durationMinutes + travelToNextBooking + nextBooking.buffer_before_minutes) * 60000;
        const deadline = new Date(nextStart.getTime() - timeNeededMs);

        if (new Date() > deadline) {
            console.log(`[GAP-FILLING] Worker ${workerId} rejected: insufficient gap before reservation at ${nextStart}`);
            return false;
        }

        return true;
    }

    /**
     * Dynamic Travel Time Estimation
     */
    async calculateTravelTimeMinutes(workerId, destLat, destLng) {
        const workerRes = await db.query("SELECT current_lat, current_lng FROM workers WHERE id = $1", [workerId]);
        if (workerRes.rowCount === 0 || !workerRes.rows[0].current_lat) {
            return dispatchConfig.reservations.defaultTravelTimeMinutes;
        }

        const w = workerRes.rows[0];
        const travelMin = await this.calculateTravelBetweenPoints(
            parseFloat(w.current_lat), parseFloat(w.current_lng), parseFloat(destLat), parseFloat(destLng)
        );
        return Math.max(10, Math.min(60, travelMin));
    }

    async calculateTravelBetweenPoints(lat1, lng1, lat2, lng2) {
        const dRes = await db.query(
            "SELECT earth_distance(ll_to_earth($1, $2), ll_to_earth($3, $4)) / 1000.0 AS distance",
            [lat1, lng1, lat2, lng2]
        );
        const distanceKm = parseFloat(dRes.rows[0].distance || 0);
        return Math.round(20 + distanceKm * 2.0); 
    }

    /**
     * Sum worker total time reserved/travel for a specific day
     */
    async getDailyWorkStats(workerId, dateObj) {
        const startOfDay = new Date(dateObj);
        startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(dateObj);
        endOfDay.setHours(23,59,59,999);

        const res = await db.query(
            `SELECT COALESCE(SUM(estimated_duration_minutes + travel_time_before_minutes * 2), 0) as total_minutes
             FROM worker_calendar
             WHERE worker_id = $1 
               AND status = 'CONFIRMED'
               AND scheduled_start BETWEEN $2 AND $3`,
            [workerId, startOfDay, endOfDay]
        );

        const totalHours = parseFloat(res.rows[0].total_minutes) / 60.0;
        return { totalHours };
    }

    /**
     * reservation monitor loop - triggers re-dispatch if worker is late
     */
    async monitorActiveReservations() {
        console.log("🔍 [RESERVATION-MONITOR] Checking upcoming bookings progress...");
        
        const queryText = `
            SELECT c.*, w.is_online, w.current_lat, w.current_lng, w.phone_number
            FROM worker_calendar c
            JOIN workers w ON c.worker_id = w.id
            WHERE c.status = 'CONFIRMED'
              AND c.scheduled_start BETWEEN NOW() AND NOW() + INTERVAL '45 minutes'
        `;
        const res = await db.query(queryText);
        if (res.rowCount === 0) return;

        for (const entry of res.rows) {
            const start = new Date(entry.scheduled_start);
            const minutesLeft = Math.round((start.getTime() - Date.now()) / 60000);

            if (!entry.is_online) {
                console.warn(`⚠️ [LATE-ARRIVAL-ALERT] Worker ${entry.worker_id} offline for reservation starting in ${minutesLeft}m. Reassigning.`);
                await this.triggerProactiveReassignment(entry, 'WORKER_OFFLINE');
                continue;
            }

            const travelMin = await this.calculateTravelBetweenPoints(
                parseFloat(entry.current_lat), parseFloat(entry.current_lng),
                parseFloat(entry.location_lat), parseFloat(entry.location_lng)
            );

            const buffer = entry.buffer_before_minutes;
            if (travelMin > minutesLeft + buffer) {
                console.warn(`⚠️ [LATE-ARRIVAL-ALERT] Worker ETA (${travelMin} mins) exceeds remaining time (${minutesLeft} mins + ${buffer}m buffer). Reassigning.`);
                await this.triggerProactiveReassignment(entry, 'LATE_ARRIVAL_PREDICTED');
            }
        }
    }

    /**
     * Automatically release the worker and re-queue the job in Scheduled Recovery Queue
     */
    async triggerProactiveReassignment(calendarEntry, reason) {
        const jobId = calendarEntry.booking_id;
        const workerId = calendarEntry.worker_id;

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                "UPDATE worker_calendar SET status = 'CANCELLED' WHERE id = $1",
                [calendarEntry.id]
            );

            await client.query(
                "UPDATE workers SET availability_state = 'AVAILABLE' WHERE id = $1 AND availability_state = 'RESERVED'",
                [workerId]
            );

            await client.query(
                "UPDATE jobs SET worker_id = NULL, status = 'REDISTRIBUTING', updated_at = NOW() WHERE id = $1",
                [jobId]
            );

            await client.query('COMMIT');

            const io = getIO();
            if (io) {
                io.to(`worker:${calendarEntry.phone_number}`).emit('job_cancelled', { jobId, reason });
            }

            await redis.set(`job:${jobId}:status`, 'REDISTRIBUTING');

            const dispatchQueue = require('./dispatch_queue.service');
            await dispatchQueue.handleEmergencyRecovery(jobId);

        } catch (e) {
            await client.query('ROLLBACK');
            console.error(`❌ Failed reassigning calendar job ${jobId}:`, e.message);
        } finally {
            client.release();
        }
    }

    async predictJobDuration(category) {
        try {
            const optService = require('./marketplace_optimization.service');
            const res = optService.predictJobDuration(category, 'default');
            return res.estimatedDurationMins;
        } catch (err) {
            return 90; // safe default
        }
    }

    async releaseTimeBlock(jobId) {
        await db.query(
            "UPDATE worker_calendar SET status = 'CANCELLED' WHERE booking_id = $1",
            [jobId]
        );
        const cal = await db.query("SELECT worker_id FROM worker_calendar WHERE booking_id = $1 LIMIT 1", [jobId]);
        if (cal.rowCount > 0) {
            await db.query(
                `UPDATE workers 
                 SET availability_state = 'AVAILABLE' 
                 WHERE id = $1 AND availability_state = 'RESERVED'`,
                [cal.rows[0].worker_id]
            );
        }
    }
}

module.exports = new ReservationService();
