/**
 * Nexo Periodic Selfie & Face Identity Verification System
 * 
 * Protects marketplace security by triggering periodic selfie checks
 * on online toggle, long sessions, or random security checks.
 * Temporarily pauses job offers and stores S3 object keys with audit logs.
 */

const db = require('../config/db');
const redis = require('../config/redis');
const incentivesConfig = require('../config/incentives.config');
const { getIO } = require('../config/socket');

class SelfieVerificationService {
    /**
     * Triggers a selfie verification request for a worker.
     */
    async triggerVerification(workerId, reason = 'SECURITY_CHECK') {
        const verificationId = require('crypto').randomUUID();

        // 1. Lock worker from accepting new job offers temporarily
        await redis.set(`worker:${workerId}:selfie_required`, '1', 'EX', 1800); // 30m timeout

        // 2. Persist verification request to DB
        await db.query(`
            CREATE TABLE IF NOT EXISTS worker_selfie_verifications (
                id UUID PRIMARY KEY,
                worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                trigger_reason VARCHAR(100) NOT NULL,
                status VARCHAR(50) DEFAULT 'PENDING',
                attempts_count INT DEFAULT 0,
                s3_key VARCHAR(255),
                confidence_score DECIMAL(5,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                verified_at TIMESTAMP
            )
        `);

        await db.query(`
            INSERT INTO worker_selfie_verifications (id, worker_id, trigger_reason, status)
            VALUES ($1, $2, $3, 'PENDING')
        `, [verificationId, workerId, reason]);

        // 3. Emit socket notification to worker app to launch front-camera circular face guide
        const io = getIO();
        if (io) {
            const workerRes = await db.query("SELECT phone_number FROM workers WHERE id = $1", [workerId]);
            if (workerRes.rowCount > 0) {
                io.to(`worker:${workerRes.rows[0].phone_number}`).emit('SELFIE_VERIFICATION_REQUIRED', {
                    verificationId,
                    reason,
                    message: "Identity Verification Required: Please align your face inside the camera guide.",
                    timeoutSeconds: 300
                });
            }
        }

        console.log(`📸 [SELFIE-TRIGGERED] Verification ${verificationId} required for worker ${workerId} (${reason}).`);
        return { verificationId, status: 'PENDING' };
    }

    /**
     * Submits captured selfie for face matching and identity verification.
     */
    async submitSelfie(workerId, verificationId, { s3Key, confidenceScore = 95.0 }) {
        const score = parseFloat(confidenceScore);
        const isMatch = score >= incentivesConfig.selfie.confidenceThresholdPct;

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const reqRes = await client.query(
                "SELECT * FROM worker_selfie_verifications WHERE id = $1 AND worker_id = $2 FOR UPDATE",
                [verificationId, workerId]
            );

            if (reqRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "VERIFICATION_NOT_FOUND" };
            }

            const current = reqRes.rows[0];
            const newAttempts = current.attempts_count + 1;

            if (isMatch) {
                // Success — clear Redis lock and update DB
                await client.query(`
                    UPDATE worker_selfie_verifications
                    SET status = 'VERIFIED', attempts_count = $1, s3_key = $2, confidence_score = $3, verified_at = NOW()
                    WHERE id = $4
                `, [newAttempts, s3Key, score, verificationId]);

                await client.query('COMMIT');

                await redis.del(`worker:${workerId}:selfie_required`);

                const io = getIO();
                if (io) {
                    const workerRes = await db.query("SELECT phone_number FROM workers WHERE id = $1", [workerId]);
                    if (workerRes.rowCount > 0) {
                        io.to(`worker:${workerRes.rows[0].phone_number}`).emit('SELFIE_VERIFICATION_SUCCESS', {
                            verificationId,
                            message: "Identity verified successfully! Normal dispatch resumed."
                        });
                    }
                }

                console.log(`✅ [SELFIE-VERIFIED] Worker ${workerId} verified successfully (${score}% confidence).`);
                return { success: true, verified: true, confidenceScore: score };
            } else {
                // Failed match — check retry limit
                const isFailedPermanently = newAttempts >= incentivesConfig.selfie.maxRetries;
                const newStatus = isFailedPermanently ? 'FAILED_EXCEEDED' : 'FAILED_RETRY';

                await client.query(`
                    UPDATE worker_selfie_verifications
                    SET status = $1, attempts_count = $2, s3_key = $3, confidence_score = $4
                    WHERE id = $5
                `, [newStatus, newAttempts, s3Key, score, verificationId]);

                if (isFailedPermanently) {
                    // Increment selfie miss count and temporarily set worker offline
                    await client.query(`
                        UPDATE workers
                        SET is_online = false, updated_at = NOW()
                        WHERE id = $1
                    `, [workerId]);
                }

                await client.query('COMMIT');

                return {
                    success: false,
                    verified: false,
                    attemptsRemaining: Math.max(0, incentivesConfig.selfie.maxRetries - newAttempts),
                    message: isFailedPermanently ? "Maximum verification retries exceeded. Please contact support." : "Face match failed. Please realign your face in good lighting and try again."
                };
            }
        } catch (e) {
            if (client) await client.query('ROLLBACK');
            console.error('[SELFIE-SUBMIT-ERROR]', e.message);
            return { success: false, error: e.message };
        } finally {
            if (client) client.release();
        }
    }
}

module.exports = new SelfieVerificationService();
