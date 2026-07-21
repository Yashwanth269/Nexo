const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jobStateMachine = require('../services/job_state_machine.service');
const otpService = require('../services/otp.service');
const disputeService = require('../services/dispute.service');

/**
 * POST /api/jobs/:id/transition
 * Executes a deterministic state transition in the lifecycle with validation gates.
 */
router.post('/:id/transition', async (req, res) => {
    const jobId = req.params.id;
    const { toState, otp, beforePhoto, afterPhoto, checklist, signature, reason } = req.body;
    
    // Resolve authorized party
    const workerId = req.body.workerId || null;
    const userId = req.body.userId || null;

    try {
        const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }
        
        const job = jobRes.rows[0];
        const resolvedTo = jobStateMachine.resolveState(toState);

        // 1. Validation Gates for State Transitions
        if (resolvedTo === jobStateMachine.STATES.OTP_VERIFIED) {
            if (!otp) {
                return res.status(400).json({ success: false, error: "OTP_REQUIRED", message: "Start OTP is required to start the service" });
            }
            const otpCheck = await otpService.verifyStartOtp(jobId, workerId || job.worker_id, otp);
            if (!otpCheck.success) {
                return res.status(400).json({ success: false, error: "INVALID_OTP", message: "Invalid Start OTP code" });
            }
            // otpService.verifyStartOtp already handles status transitions to WORK_IN_PROGRESS/SERVICE_STARTED
            return res.json({ success: true, from: job.status, to: jobStateMachine.STATES.SERVICE_STARTED });
        }

        if (resolvedTo === jobStateMachine.STATES.CUSTOMER_VERIFIED) {
            if (!otp) {
                return res.status(400).json({ success: false, error: "OTP_REQUIRED", message: "Completion OTP is required to verify completion" });
            }
            const otpCheck = await otpService.verifyCompletionOtp(jobId, workerId || job.worker_id, otp);
            if (!otpCheck.success) {
                return res.status(400).json({ success: false, error: "INVALID_OTP", message: "Invalid Completion OTP code" });
            }
            return res.json({ success: true, from: job.status, to: jobStateMachine.STATES.CUSTOMER_VERIFIED });
        }

        if (resolvedTo === jobStateMachine.STATES.SERVICE_COMPLETED) {
            // Validate required photo evidence and checklists before marking completed
            const currentPhotosRes = await db.query("SELECT before_photos, after_photos, checklist FROM jobs WHERE id = $1", [jobId]);
            const currentJobDetails = currentPhotosRes.rows[0] || {};
            
            const beforePhotos = currentJobDetails.before_photos || [];
            const afterPhotos = currentJobDetails.after_photos || [];
            const jobChecklist = currentJobDetails.checklist || [];

            if (beforePhotos.length === 0 && !beforePhoto) {
                return res.status(400).json({ success: false, error: "BEFORE_PHOTOS_REQUIRED", message: "Before photos must be uploaded before completion" });
            }

            if (afterPhotos.length === 0 && !afterPhoto) {
                return res.status(400).json({ success: false, error: "AFTER_PHOTOS_REQUIRED", message: "After completion photos must be uploaded" });
            }

            if (jobChecklist.length === 0 && (!checklist || checklist.length === 0)) {
                return res.status(400).json({ success: false, error: "CHECKLIST_REQUIRED", message: "Work completion checklist must be populated" });
            }

            // Save signatures if present
            if (signature) {
                await db.query("UPDATE jobs SET worker_signature = $1 WHERE id = $2", [signature, jobId]);
            }
            if (checklist) {
                await db.query("UPDATE jobs SET checklist = $1 WHERE id = $2", [JSON.stringify(checklist), jobId]);
            }
        }

        if (resolvedTo === jobStateMachine.STATES.CANCELLED) {
            if (!reason) {
                return res.status(400).json({ success: false, error: "CANCELLATION_REASON_REQUIRED", message: "A reason is required to cancel jobs" });
            }
            // Save cancellation details
            await db.query(`
                INSERT INTO job_cancellations (job_id, worker_id, reason)
                VALUES ($1, $2, $3)
            `, [jobId, workerId || job.worker_id, reason]);
        }

        // 2. Perform state machine transition
        const result = await jobStateMachine.transition(jobId, resolvedTo, {
            userId,
            workerId: workerId || job.worker_id,
            reason,
            metadata: req.body.metadata || {}
        });

        res.json({
            success: true,
            from: result.from,
            to: result.to
        });
    } catch (err) {
        console.error('[JOB-LIFECYCLE-ROUTE-ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/jobs/:id/timeline
 * Fetches the immutable transition history / audit logs for the job.
 */
router.get('/:id/timeline', async (req, res) => {
    try {
        const historyRes = await db.query(`
            SELECT id, status, metadata, timestamp 
            FROM job_history 
            WHERE job_id = $1::uuid 
            ORDER BY timestamp ASC
        `, [req.params.id]);

        res.json({
            success: true,
            jobId: req.params.id,
            timeline: historyRes.rows
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/jobs/:id/evidence
 * Upload work photo evidence (Before/After/Invoice).
 */
router.post('/:id/evidence', async (req, res) => {
    const jobId = req.params.id;
    const { type, photoUrl } = req.body; // type can be 'before', 'after', 'invoice', 'document'

    if (!type || !photoUrl) {
        return res.status(400).json({ success: false, message: "Type and photoUrl are required" });
    }

    try {
        let fieldName = 'before_photos';
        if (type === 'after') fieldName = 'after_photos';

        if (fieldName === 'before_photos' || fieldName === 'after_photos') {
            await db.query(`
                UPDATE jobs 
                SET ${fieldName} = array_append(${fieldName}, $1), updated_at = CURRENT_TIMESTAMP 
                WHERE id = $2
            `, [photoUrl, jobId]);
        } else {
            // documents array
            const currentDocRes = await db.query("SELECT documents FROM jobs WHERE id = $1", [jobId]);
            const docs = currentDocRes.rows[0]?.documents || [];
            docs.push({ type, url: photoUrl, uploadedAt: new Date().toISOString() });
            
            await db.query(`
                UPDATE jobs SET documents = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
            `, [JSON.stringify(docs), jobId]);
        }

        res.json({ success: true, message: `Photo evidence registered under ${type}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/jobs/:id/dispute
 * File dispute. Holds payouts.
 */
router.post('/:id/dispute', async (req, res) => {
    const jobId = req.params.id;
    const { initiatorId, initiatorRole, respondentId, reason, description, evidence } = req.body;

    try {
        const paymentRes = await db.query("SELECT id FROM payments WHERE job_id = $1 LIMIT 1", [jobId]);
        const paymentId = paymentRes.rows[0]?.id || null;

        // Transition job to DISPUTED status
        await jobStateMachine.transition(jobId, 'DISPUTED', { reason, metadata: { description } });

        const dispute = await disputeService.createDispute(
            paymentId,
            jobId,
            initiatorId,
            initiatorRole,
            respondentId,
            reason,
            description,
            evidence || []
        );

        res.json({
            success: true,
            message: "Dispute registered successfully. Job payout held.",
            dispute
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
