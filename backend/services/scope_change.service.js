/**
 * Nexo Scope Change & Additional Work Request Service
 * 
 * Manages in-app additional work / parts requests created by workers
 * with explicit customer approval and automated payment escrow adjustment.
 * Prevents off-platform cash negotiations.
 */

const db = require('../config/db');
const { getIO } = require('../config/socket');
const eventBus = require('./event_bus.service');

class ScopeChangeService {
    /**
     * Creates an additional work request with material/labour split, evidence photos, and AI price validation.
     */
    async requestAdditionalWork(jobId, workerId, { title, description, extraAmount, materialPrice, labourPrice, evidencePhotoUrl }) {
        const mat = parseFloat(materialPrice || 0);
        const lab = parseFloat(labourPrice || 0);
        let amount = mat + lab;
        if (amount <= 0 && extraAmount) {
            amount = parseFloat(extraAmount);
        }

        if (isNaN(amount) || amount <= 0) {
            return { success: false, message: "INVALID_AMOUNT" };
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const jobRes = await client.query(
                "SELECT id, user_id, price, category FROM jobs WHERE id = $1 AND worker_id = $2 FOR UPDATE",
                [jobId, workerId]
            );

            if (jobRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "JOB_NOT_FOUND_OR_UNAUTHORIZED" };
            }

            const job = jobRes.rows[0];

            // AI price validation comparison (Requirement 1)
            const averages = {
                'AC REPAIR': { avg: 350, min: 280, max: 380 },
                'FAN INSTALLATION': { avg: 150, min: 120, max: 180 },
                'PLUMBING': { avg: 250, min: 200, max: 300 },
                'PAINTING': { avg: 400, min: 300, max: 500 }
            };

            const jobCat = (job.category || 'AC REPAIR').toUpperCase();
            let aiValidationWarning = null;
            if (averages[jobCat]) {
                const limit = averages[jobCat];
                if (amount > limit.max) {
                    aiValidationWarning = `⚠ Higher than average. Typical price for ${job.category || 'this category'} is ₹${limit.min}-₹${limit.max}`;
                }
            }

            // Create table structure & add new columns dynamically if needed
            await client.query(`
                CREATE TABLE IF NOT EXISTS job_scope_change_requests (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
                    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    extra_amount DECIMAL(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'PENDING_APPROVAL',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await client.query(`ALTER TABLE job_scope_change_requests ADD COLUMN IF NOT EXISTS material_price DECIMAL(10, 2) DEFAULT 0.00`);
            await client.query(`ALTER TABLE job_scope_change_requests ADD COLUMN IF NOT EXISTS labour_price DECIMAL(10, 2) DEFAULT 0.00`);
            await client.query(`ALTER TABLE job_scope_change_requests ADD COLUMN IF NOT EXISTS evidence_photo_url VARCHAR(512)`);
            await client.query(`ALTER TABLE job_scope_change_requests ADD COLUMN IF NOT EXISTS ai_validation_warning VARCHAR(256)`);

            const reqRes = await client.query(`
                INSERT INTO job_scope_change_requests (
                    job_id, worker_id, title, description, extra_amount, material_price, labour_price, evidence_photo_url, ai_validation_warning
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `, [jobId, workerId, title, description, amount, mat, lab, evidencePhotoUrl || null, aiValidationWarning]);

            await client.query('COMMIT');

            const scopeReq = reqRes.rows[0];

            // Publish scope change request to event bus
            eventBus.publish('SCOPE_CHANGE', {
                requestId: scopeReq.id,
                jobId,
                workerId,
                extraAmount: amount,
                materialPrice: mat,
                labourPrice: lab,
                aiValidationWarning
            });

            // Notify customer via socket
            const io = getIO();
            if (io) {
                io.to(`user:${job.user_id}`).emit('additional_work_requested', {
                    requestId: scopeReq.id,
                    jobId,
                    title,
                    description,
                    extraAmount: amount,
                    materialPrice: mat,
                    labourPrice: lab,
                    evidencePhotoUrl: evidencePhotoUrl || null,
                    aiValidationWarning,
                    currentPrice: parseFloat(job.price),
                    newPrice: parseFloat(job.price) + amount,
                    message: `Professional requested additional work/parts (${title}): +₹${amount}. ${aiValidationWarning || ''}`
                });
            }

            return { success: true, request: scopeReq };
        } catch (e) {
            if (client) await client.query('ROLLBACK');
            console.error('[SCOPE-CHANGE-REQUEST-ERROR]', e.message);
            return { success: false, error: e.message };
        } finally {
            if (client) client.release();
        }
    }

    /**
     * Customer approves or declines additional work request.
     */
    async respondToAdditionalWork(jobId, userId, requestId, approved) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const reqRes = await client.query(
                "SELECT * FROM job_scope_change_requests WHERE id = $1 AND job_id = $2 FOR UPDATE",
                [requestId, jobId]
            );

            if (reqRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "REQUEST_NOT_FOUND" };
            }

            const scopeReq = reqRes.rows[0];
            if (scopeReq.status !== 'PENDING_APPROVAL') {
                await client.query('ROLLBACK');
                return { success: false, message: `Request already ${scopeReq.status}` };
            }

            const newStatus = approved ? 'APPROVED' : 'DECLINED';
            await client.query(
                "UPDATE job_scope_change_requests SET status = $1, updated_at = NOW() WHERE id = $2",
                [newStatus, requestId]
            );

            if (approved) {
                const updatedJob = await client.query(
                    "UPDATE jobs SET price = price + $1, updated_at = NOW() WHERE id = $2 RETURNING price",
                    [scopeReq.extra_amount, jobId]
                );

                await client.query('COMMIT');

                const io = getIO();
                if (io) {
                    io.to(`job:${jobId}`).emit('additional_work_updated', {
                        requestId,
                        jobId,
                        status: 'APPROVED',
                        extraAmount: parseFloat(scopeReq.extra_amount),
                        newTotalPrice: parseFloat(updatedJob.rows[0].price),
                        message: `Additional work approved! New total price: ₹${updatedJob.rows[0].price}`
                    });
                }

                return { success: true, status: 'APPROVED', newPrice: updatedJob.rows[0].price };
            } else {
                await client.query('COMMIT');

                const io = getIO();
                if (io) {
                    io.to(`job:${jobId}`).emit('additional_work_updated', {
                        requestId,
                        jobId,
                        status: 'DECLINED',
                        message: `Customer declined additional work request (${scopeReq.title}).`
                    });
                }

                return { success: true, status: 'DECLINED' };
            }
        } catch (e) {
            if (client) await client.query('ROLLBACK');
            console.error('[SCOPE-CHANGE-RESPONSE-ERROR]', e.message);
            return { success: false, error: e.message };
        } finally {
            if (client) client.release();
        }
    }
}

module.exports = new ScopeChangeService();
