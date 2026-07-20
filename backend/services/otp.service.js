/**
 * Nexo Job OTP Verification Service
 * 
 * Prevents false-start fraud and fake-completion fraud by requiring
 * customer-provided Start OTP and Completion OTP.
 */

const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');

class OtpService {
    /**
     * Generates a 4-digit Start OTP for a job.
     */
    async generateStartOtp(jobId) {
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        
        await db.query(
            "UPDATE jobs SET start_otp = $1, updated_at = NOW() WHERE id = $2",
            [otpCode, jobId]
        );
        await redis.set(`job:${jobId}:start_otp`, otpCode, 'EX', 86400);

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
        let cachedOtp = await redis.get(`job:${jobId}:start_otp`);
        
        if (!cachedOtp) {
            const res = await db.query("SELECT start_otp FROM jobs WHERE id = $1", [jobId]);
            cachedOtp = res.rows[0]?.start_otp;
        }

        if (!cachedOtp || cachedOtp !== otpCode.toString()) {
            return { success: false, message: "INVALID_START_OTP" };
        }

        // Mark OTP verified in DB
        await db.query(
            "UPDATE jobs SET start_otp_verified = true, status = 'WORK_IN_PROGRESS', started_at = NOW() WHERE id = $1 AND worker_id = $2",
            [jobId, workerId]
        );
        await redis.del(`job:${jobId}:start_otp`);

        const io = getIO();
        if (io) {
            io.to(`job:${jobId}`).emit('job_status_updated', {
                jobId,
                status: 'WORK_IN_PROGRESS',
                message: "Work has officially started!"
            });
        }

        return { success: true, message: "START_OTP_VERIFIED" };
    }

    /**
     * Generates a 4-digit Completion OTP for a job.
     */
    async generateCompletionOtp(jobId) {
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        
        await db.query(
            "UPDATE jobs SET completion_otp = $1, updated_at = NOW() WHERE id = $2",
            [otpCode, jobId]
        );
        await redis.set(`job:${jobId}:completion_otp`, otpCode, 'EX', 86400);

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
        let cachedOtp = await redis.get(`job:${jobId}:completion_otp`);
        
        if (!cachedOtp) {
            const res = await db.query("SELECT completion_otp FROM jobs WHERE id = $1", [jobId]);
            cachedOtp = res.rows[0]?.completion_otp;
        }

        if (!cachedOtp || cachedOtp !== otpCode.toString()) {
            return { success: false, message: "INVALID_COMPLETION_OTP" };
        }

        await db.query(
            "UPDATE jobs SET completion_otp_verified = true, status = 'COMPLETED', completed_at = NOW() WHERE id = $1 AND worker_id = $2",
            [jobId, workerId]
        );
        await redis.del(`job:${jobId}:completion_otp`);

        const io = getIO();
        if (io) {
            io.to(`job:${jobId}`).emit('job_status_updated', {
                jobId,
                status: 'COMPLETED',
                message: "Job completed and verified via OTP!"
            });
        }

        return { success: true, message: "COMPLETION_OTP_VERIFIED" };
    }
}

module.exports = new OtpService();
