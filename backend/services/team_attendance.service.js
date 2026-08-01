'use strict';

const db = require('../config/db');

// Helper to calculate distance in meters between two coordinates using Haversine formula
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

class TeamAttendanceService {
    /**
     * GPS-verified Worker Check-In.
     */
    async checkIn(teamJobId, workerId, lat, lng, faceVerified = false) {
        // Resolve job
        const jobRes = await db.query(
            "SELECT location_lat, location_lng, start_time, user_id FROM team_jobs WHERE id = $1",
            [teamJobId]
        );
        if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
        const job = jobRes.rows[0];

        // Verify membership
        const memberCheck = await db.query(
            "SELECT id FROM team_members WHERE team_job_id = $1 AND worker_id = $2",
            [teamJobId, workerId]
        );
        if (memberCheck.rowCount === 0) throw new Error('NOT_TEAM_MEMBER');

        const distance = calculateDistanceMeters(
            parseFloat(lat), parseFloat(lng),
            parseFloat(job.location_lat), parseFloat(job.location_lng)
        );

        const GEOFENCE_RADIUS_METERS = 200; // 200m geofence limit

        if (distance > GEOFENCE_RADIUS_METERS) {
            // Log failure
            await db.query(
                `INSERT INTO attendance_logs (team_job_id, worker_id, log_type, location_lat, location_lng, distance_from_site_meters, details)
                 VALUES ($1, $2, 'GPS_VERIFICATION_FAILED', $3, $4, $5, $6)`,
                [teamJobId, workerId, lat, lng, distance, JSON.stringify({ reason: 'Outside geofence radius' })]
            );
            throw new Error('GPS_LOCATION_MISMATCH');
        }

        // Determine status (Late if 15 mins past start_time)
        const todayDate = new Date().toISOString().slice(0, 10);
        let status = 'PRESENT';
        
        // Simple late check
        if (job.start_time) {
            const now = new Date();
            const [hours, minutes] = job.start_time.split(':');
            const startTimeToday = new Date();
            startTimeToday.setHours(parseInt(hours), parseInt(minutes), 0);
            
            // If now is 15 minutes past start time
            if (now.getTime() > startTimeToday.getTime() + (15 * 60 * 1000)) {
                status = 'LATE';
            }
        }

        // Record check-in
        const checkInRes = await db.query(
            `INSERT INTO team_attendance (team_job_id, worker_id, work_date, check_in_time, check_in_lat, check_in_lng, status, face_verified)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7)
             ON CONFLICT (team_job_id, worker_id, work_date) 
             DO UPDATE SET check_in_time = CURRENT_TIMESTAMP, check_in_lat = $4, check_in_lng = $5, status = $6, face_verified = $7
             RETURNING *;`,
            [teamJobId, workerId, todayDate, lat, lng, status, faceVerified]
        );

        // Log success
        await db.query(
            `INSERT INTO attendance_logs (team_job_id, worker_id, log_type, location_lat, location_lng, distance_from_site_meters, details)
             VALUES ($1, $2, 'CHECK_IN_ATTEMPT', $3, $4, $5, $6)`,
            [teamJobId, workerId, lat, lng, distance, JSON.stringify({ success: true, status })]
        );

        // Notify customer
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`user:${job.user_id}`).emit('team_worker_checked_in', {
                    teamJobId,
                    workerId,
                    status,
                    attendanceId: checkInRes.rows[0].id
                });
            }
        } catch (e) {
            console.warn('[TEAM_ATTENDANCE] Socket notification to user failed:', e.message);
        }

        return checkInRes.rows[0];
    }

    /**
     * Customer confirms Check-In.
     */
    async confirmCheckIn(attendanceId, userId, confirm) {
        const query = `
            UPDATE team_attendance 
            SET check_in_confirmed = $1 
            WHERE id = $2 AND EXISTS (
                SELECT 1 FROM team_jobs 
                WHERE team_jobs.id = team_attendance.team_job_id AND team_jobs.user_id = $3
            ) RETURNING *;
        `;
        const res = await db.query(query, [confirm, attendanceId, userId]);
        if (res.rowCount === 0) throw new Error('ATTENDANCE_RECORD_NOT_FOUND_OR_ACCESS_DENIED');
        return res.rows[0];
    }

    /**
     * GPS-verified Worker Check-Out.
     */
    async checkOut(teamJobId, workerId, lat, lng) {
        const jobRes = await db.query(
            "SELECT location_lat, location_lng, user_id FROM team_jobs WHERE id = $1",
            [teamJobId]
        );
        if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
        const job = jobRes.rows[0];

        const distance = calculateDistanceMeters(
            parseFloat(lat), parseFloat(lng),
            parseFloat(job.location_lat), parseFloat(job.location_lng)
        );

        const GEOFENCE_RADIUS_METERS = 200;

        if (distance > GEOFENCE_RADIUS_METERS) {
            // Log failure
            await db.query(
                `INSERT INTO attendance_logs (team_job_id, worker_id, log_type, location_lat, location_lng, distance_from_site_meters, details)
                 VALUES ($1, $2, 'GPS_VERIFICATION_FAILED', $3, $4, $5, $6)`,
                [teamJobId, workerId, lat, lng, distance, JSON.stringify({ reason: 'Check-out outside geofence' })]
            );
            throw new Error('GPS_LOCATION_MISMATCH');
        }

        const todayDate = new Date().toISOString().slice(0, 10);

        const res = await db.query(
            `UPDATE team_attendance 
             SET check_out_time = CURRENT_TIMESTAMP, check_out_lat = $1, check_out_lng = $2, check_out_confirmed = true
             WHERE team_job_id = $3 AND worker_id = $4 AND work_date = $5
             RETURNING *;`,
            [lat, lng, teamJobId, workerId, todayDate]
        );

        if (res.rowCount === 0) throw new Error('CHECK_IN_RECORD_NOT_FOUND_FOR_TODAY');

        // Log check-out success
        await db.query(
            `INSERT INTO attendance_logs (team_job_id, worker_id, log_type, location_lat, location_lng, distance_from_site_meters, details)
             VALUES ($1, $2, 'CHECK_OUT_ATTEMPT', $3, $4, $5, $6)`,
            [teamJobId, workerId, lat, lng, distance, JSON.stringify({ success: true })]
        );

        // Notify customer
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`user:${job.user_id}`).emit('team_worker_checked_out', {
                    teamJobId,
                    workerId,
                    attendanceId: res.rows[0].id
                });
            }
        } catch (e) {
            console.warn('[TEAM_ATTENDANCE] Socket notification to user failed:', e.message);
        }

        return res.rows[0];
    }

    /**
     * Upload Daily Progress by Team Leader.
     */
    async uploadDailyProgress(data) {
        const { teamJobId, leaderId, percentageCompleted, remarks, materialsUsed = [], problemsFaced = '', photos = [], videoUrl = null } = data;

        // Verify leader
        const jobRes = await db.query("SELECT leader_id, user_id FROM team_jobs WHERE id = $1", [teamJobId]);
        if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
        const job = jobRes.rows[0];

        if (job.leader_id !== leaderId) throw new Error('NOT_AUTHORIZED_LEADER');

        const todayDate = new Date().toISOString().slice(0, 10);

        const query = `
            INSERT INTO daily_progress (
                team_job_id, work_date, percentage_completed, remarks, materials_used, problems_faced, photos, video_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (team_job_id, work_date)
            DO UPDATE SET percentage_completed = $3, remarks = $4, materials_used = $5, problems_faced = $6, photos = $7, video_url = $8
            RETURNING *;
        `;

        const res = await db.query(query, [
            teamJobId, todayDate, percentageCompleted, remarks, JSON.stringify(materialsUsed), problemsFaced, photos, videoUrl
        ]);

        // Notify customer
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`user:${job.user_id}`).emit('team_progress_updated', {
                    teamJobId,
                    percentageCompleted,
                    remarks
                });
            }
        } catch (e) {
            console.warn('[TEAM_ATTENDANCE] Socket progress update failed:', e.message);
        }

        return res.rows[0];
    }

    /**
     * Fetch Daily Progress log/timeline for a Job.
     */
    async getDailyTimeline(teamJobId) {
        const progressRes = await db.query(
            "SELECT * FROM daily_progress WHERE team_job_id = $1 ORDER BY work_date ASC",
            [teamJobId]
        );
        const attendanceRes = await db.query(
            `SELECT ta.*, w.full_name as worker_name 
             FROM team_attendance ta
             JOIN workers w ON ta.worker_id = w.id
             WHERE ta.team_job_id = $1 
             ORDER BY ta.work_date ASC, ta.check_in_time ASC`,
            [teamJobId]
        );

        return {
            progressLogs: progressRes.rows,
            attendanceLogs: attendanceRes.rows
        };
    }
}

module.exports = new TeamAttendanceService();
