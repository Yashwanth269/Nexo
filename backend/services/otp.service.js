/**
 * Nexo Job OTP Verification Service
 */

const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');
const crypto = require('crypto');

// Generate SHA256 OTP Hash with salt
function hashOtp(otp, jobId) {
    return crypto.createHash('sha256').update(`${otp}:${jobId}:nexo-salt`).digest('hex');
}

class OtpService {
    /**
     * Generates a 4-digit Start OTP for a job.
     */
    async generateStartOtp(jobId) {
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        const hashed = hashOtp(otpCode, jobId);
        
        // OTP valid for 10 minutes (Point 3)
        const expiry = new Date(Date.now() + 10 * 60 * 1000);

        await db.query(
            "UPDATE jobs SET start_otp = $1, start_otp_expiry = $2, updated_at = NOW() WHERE id = $3",
            [hashed, expiry, jobId]
        );
        await redis.set(`job:${jobId}:start_otp`, hashed, 'EX', 600);

        // Notify customer via socket
        const jobRes = await db.query("SELECT user_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount > 0) {
            const io = getIO();
            if (io) {
                io.to(`user:${jobRes.rows[0].user_id}`).emit('start_otp_generated', {
                    jobId,
                    startOtp: otpCode,
                    message: `Share Start OTP ${otpCode} with your professional when they arrive.`
                });
            }
        }

        return otpCode;
    }

    /**
     * Verifies Start OTP entered by worker.
     */
    async verifyStartOtp(jobId, workerId, otpCode) {
        const lockKey = `otp_lock:start:${jobId}:${workerId}`;
        const attemptsKey = `otp_attempts:start:${jobId}:${workerId}`;

        // 1. Brute Force Protection (Point 2)
        const isLocked = await redis.get(lockKey);
        if (isLocked) {
            return { success: false, message: "TOO_MANY_ATTEMPTS_LOCKED_10M" };
        }

        let cachedOtp = await redis.get(`job:${jobId}:start_otp`);
        let expiry = null;

        if (!cachedOtp) {
            const res = await db.query("SELECT start_otp, start_otp_expiry FROM jobs WHERE id = $1", [jobId]);
            cachedOtp = res.rows[0]?.start_otp;
            expiry = res.rows[0]?.start_otp_expiry;
        }

        const inputHashed = hashOtp(otpCode, jobId);

        // Verify matches and expiry (Point 3)
        const isExpired = expiry && new Date() > new Date(expiry);
        if (!cachedOtp || cachedOtp !== inputHashed || isExpired) {
            // Increment attempts counter
            const attempts = await redis.incr(attemptsKey);
            if (attempts === 1) {
                await redis.expire(attemptsKey, 600);
            }
            if (attempts >= 5) {
                await redis.set(lockKey, '1', 'EX', 600);
                await redis.del(attemptsKey);
                return { success: false, message: "TOO_MANY_ATTEMPTS_LOCKED_10M" };
            }
            return { success: false, message: "INVALID_START_OTP", remainingAttempts: 5 - attempts };
        }

        // 2. Wrap OTP Nullification and Transitions inside transaction (Points 4 & 5)
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Replay protection: Clear OTP details immediately upon verification
            await client.query(
                "UPDATE jobs SET start_otp_verified = true, start_otp = NULL, start_otp_expiry = NULL WHERE id = $1 AND worker_id = $2",
                [jobId, workerId]
            );

            const jobStateMachine = require('./job_state_machine.service');
            await jobStateMachine.transition(jobId, 'OTP_VERIFIED', { workerId }, client);
            await jobStateMachine.transition(jobId, 'SERVICE_STARTED', { workerId }, client);

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        await redis.del(`job:${jobId}:start_otp`);
        await redis.del(attemptsKey);

        return { success: true, message: "START_OTP_VERIFIED" };
    }

    /**
     * Generates a 4-digit Completion OTP for a job.
     */
    async generateCompletionOtp(jobId) {
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        const hashed = hashOtp(otpCode, jobId);
        
        // OTP valid for 10 minutes
        const expiry = new Date(Date.now() + 10 * 60 * 1000);

        await db.query(
            "UPDATE jobs SET completion_otp = $1, completion_otp_expiry = $2, updated_at = NOW() WHERE id = $3",
            [hashed, expiry, jobId]
        );
        await redis.set(`job:${jobId}:completion_otp`, hashed, 'EX', 600);

        const jobRes = await db.query("SELECT user_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount > 0) {
            const io = getIO();
            if (io) {
                io.to(`user:${jobRes.rows[0].user_id}`).emit('completion_otp_generated', {
                    jobId,
                    completionOtp: otpCode,
                    message: `Share Completion OTP ${otpCode} with your professional once work is finished.`
                });
            }
        }

        return otpCode;
    }

    /**
     * Verifies Completion OTP entered by worker.
     */
    async verifyCompletionOtp(jobId, workerId, otpCode) {
        const lockKey = `otp_lock:completion:${jobId}:${workerId}`;
        const attemptsKey = `otp_attempts:completion:${jobId}:${workerId}`;

        const isLocked = await redis.get(lockKey);
        if (isLocked) {
            return { success: false, message: "TOO_MANY_ATTEMPTS_LOCKED_10M" };
        }

        let cachedOtp = await redis.get(`job:${jobId}:completion_otp`);
        let expiry = null;

        if (!cachedOtp) {
            const res = await db.query("SELECT completion_otp, completion_otp_expiry FROM jobs WHERE id = $1", [jobId]);
            cachedOtp = res.rows[0]?.completion_otp;
            expiry = res.rows[0]?.completion_otp_expiry;
        }

        const inputHashed = hashOtp(otpCode, jobId);

        const isExpired = expiry && new Date() > new Date(expiry);
        if (!cachedOtp || cachedOtp !== inputHashed || isExpired) {
            const attempts = await redis.incr(attemptsKey);
            if (attempts === 1) {
                await redis.expire(attemptsKey, 600);
            }
            if (attempts >= 5) {
                await redis.set(lockKey, '1', 'EX', 600);
                await redis.del(attemptsKey);
                return { success: false, message: "TOO_MANY_ATTEMPTS_LOCKED_10M" };
            }
            return { success: false, message: "INVALID_COMPLETION_OTP", remainingAttempts: 5 - attempts };
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Replay protection: Clear OTP details immediately upon verification
            await client.query(
                "UPDATE jobs SET completion_otp_verified = true, completion_otp = NULL, completion_otp_expiry = NULL WHERE id = $1 AND worker_id = $2",
                [jobId, workerId]
            );

            const jobStateMachine = require('./job_state_machine.service');
            await jobStateMachine.transition(jobId, 'CUSTOMER_VERIFIED', { workerId }, client);

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        await redis.del(`job:${jobId}:completion_otp`);
        await redis.del(attemptsKey);

        return { success: true, message: "COMPLETION_OTP_VERIFIED" };
    }
}

module.exports = new OtpService();
