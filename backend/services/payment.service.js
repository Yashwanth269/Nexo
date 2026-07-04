const db = require('../config/db');
const walletService = require('./wallet.service');
const commissionService = require('./commission.service');
const paymentTrustService = require('./payment-trust.service');
const metrics = require('../middleware/metrics');

class PaymentService {
    async createPayment(jobId, payerId, workerId, amount, paymentMode, gatewayReference = null, client = db) {
        const res = await client.query(
            `INSERT INTO payments (job_id, payer_id, worker_id, amount, payment_mode, payment_status, gateway_reference)
             VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
             RETURNING *`,
            [jobId, payerId, workerId, amount, paymentMode, gatewayReference]
        );
        return res.rows[0];
    }

    async _creditWorkerWithCommission(workerId, amount, category, jobId, description, client) {
        const { platformFee, workerEarnings } = await commissionService.computeCommission(amount, category);

        await walletService.addFunds(
            workerId, 'WORKER', amount, 'EARNING', jobId, description, client
        );

        await walletService.deductFunds(
            workerId, 'WORKER', platformFee, 'COMMISSION', jobId,
            `Platform fee for job: ${category} (₹${platformFee})`, client
        );

        return { platformFee, workerEarnings };
    }

    async workerMarksCashReceived(paymentId, workerId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const pRes = await client.query(
                `SELECT p.*, j.category FROM payments p
                 JOIN jobs j ON j.id = p.job_id
                 WHERE p.id = $1 AND p.worker_id = $2 AND p.payment_mode = 'CASH'`,
                [paymentId, workerId]
            );
            if (pRes.rowCount === 0) {
                throw new Error("Cash payment record not found or already processed");
            }
            const payment = pRes.rows[0];

            if (payment.payment_status === 'SUCCESS') {
                await client.query('COMMIT');
                return { success: true, alreadyCompleted: true, payment };
            }

            const cRes = await client.query(
                `INSERT INTO cash_confirmations (payment_id, job_id, worker_id, user_id, amount, worker_marked_at, status)
                 VALUES ($1, $2, $3, $4, $5, NOW(), 'PENDING')
                 ON CONFLICT (payment_id) DO UPDATE SET worker_marked_at = NOW(), status = 'PENDING'
                 RETURNING *`,
                [paymentId, payment.job_id, workerId, payment.payer_id, payment.amount]
            );
            const confirmation = cRes.rows[0];

            await walletService.creditCash(workerId, payment.amount, paymentId,
                `Cash received for job: ${payment.job_id} (pending confirmation)`, client);

            await paymentTrustService.recordCashConfirmation(workerId, 'WORKER');

            await metrics.trackPaymentSuccess('CASH');

            await client.query('COMMIT');
            return { success: true, confirmation };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async confirmCashPayment(paymentId, userId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const cRes = await client.query(
                `SELECT cc.*, p.worker_id, j.category FROM cash_confirmations cc
                 JOIN payments p ON p.id = cc.payment_id
                 JOIN jobs j ON j.id = cc.job_id
                 WHERE cc.payment_id = $1 AND cc.user_id = $2 AND cc.status = 'PENDING'`,
                [paymentId, userId]
            );
            if (cRes.rowCount === 0) {
                throw new Error("Cash confirmation record not found or already confirmed");
            }
            const confirmation = cRes.rows[0];

            await client.query(
                `UPDATE cash_confirmations SET status = 'CONFIRMED', user_confirmed_at = NOW() WHERE id = $1`,
                [confirmation.id]
            );

            await client.query(
                `UPDATE payments SET payment_status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
                [paymentId]
            );

            await walletService.confirmCashRelease(confirmation.worker_id, parseFloat(confirmation.amount), paymentId,
                `Cash confirmed for job: ${confirmation.job_id}`, client);

            await paymentTrustService.recordCashConfirmation(userId, 'USER');

            await client.query('COMMIT');
            return { success: true, confirmed: true };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async autoConfirmCash(paymentId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const cRes = await client.query(
                `SELECT cc.*, p.worker_id, j.category FROM cash_confirmations cc
                 JOIN payments p ON p.id = cc.payment_id
                 JOIN jobs j ON j.id = cc.job_id
                 WHERE cc.payment_id = $1 AND cc.status = 'PENDING'`,
                [paymentId]
            );
            if (cRes.rowCount === 0) return { success: false, reason: "Not found or already confirmed" };

            const confirmation = cRes.rows[0];
            const hoursSinceWorkerMarked = (Date.now() - new Date(confirmation.worker_marked_at).getTime()) / (1000 * 60 * 60);
            if (hoursSinceWorkerMarked < 24) {
                await client.query('COMMIT');
                return { success: false, reason: "Auto-confirm window not reached (24h)" };
            }

            await client.query(
                `UPDATE cash_confirmations SET status = 'AUTO_CONFIRMED', auto_confirmed_at = NOW() WHERE id = $1`,
                [confirmation.id]
            );

            await client.query(
                `UPDATE payments SET payment_status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
                [paymentId]
            );

            await walletService.confirmCashRelease(confirmation.worker_id, parseFloat(confirmation.amount), paymentId,
                `Auto-confirmed cash for job: ${confirmation.job_id} (24h elapsed)`, client);

            await client.query('COMMIT');
            return { success: true, autoConfirmed: true };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async processOnlineJobPayment(jobId, amount, gatewayReference) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const jRes = await client.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
            if (jRes.rowCount === 0) throw new Error("Job not found");
            const job = jRes.rows[0];

            const payment = await this.createPayment(jobId, job.user_id, job.worker_id, amount, 'ONLINE', gatewayReference, client);

            await client.query(
                `UPDATE payments SET payment_status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
                [payment.id]
            );

            if (job.worker_id) {
                const { platformFee } = await this._creditWorkerWithCommission(
                    job.worker_id, amount, job.category, jobId,
                    `Earnings for job: ${job.category}`, client
                );
            }

            await client.query(
                `UPDATE jobs SET payment_method = 'ONLINE', updated_at = NOW() WHERE id = $1`,
                [jobId]
            );

            await paymentTrustService.recordSuccessfulPayment(job.worker_id, 'WORKER');
            await paymentTrustService.recordSuccessfulPayment(job.user_id, 'USER');

            await metrics.trackPaymentSuccess('ONLINE');

            await client.query('COMMIT');
            return { success: true, payment };
        } catch (e) {
            await client.query('ROLLBACK');
            await metrics.trackPaymentFailed('ONLINE');
            throw e;
        } finally {
            client.release();
        }
    }

    async processPartialPayment(jobId, advanceAmount, remainingCashAmount, gatewayReference) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const jRes = await client.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
            if (jRes.rowCount === 0) throw new Error("Job not found");
            const job = jRes.rows[0];

            const advancePayment = await this.createPayment(jobId, job.user_id, job.worker_id, advanceAmount, 'ADVANCE', gatewayReference, client);
            await client.query(
                `UPDATE payments SET payment_status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
                [advancePayment.id]
            );

            if (job.worker_id) {
                const { platformFee } = await this._creditWorkerWithCommission(
                    job.worker_id, advanceAmount, job.category, jobId,
                    `Advance payment for job: ${job.category}`, client
                );
            }

            const cashPayment = await this.createPayment(jobId, job.user_id, job.worker_id, remainingCashAmount, 'CASH', null, client);

            await client.query(
                `UPDATE jobs SET payment_method = 'PARTIAL', updated_at = NOW() WHERE id = $1`,
                [jobId]
            );

            await paymentTrustService.recordSuccessfulPayment(job.user_id, 'USER');

            await metrics.trackPaymentSuccess('ADVANCE');

            await client.query('COMMIT');
            return { success: true, advancePayment, cashPayment };
        } catch (e) {
            await client.query('ROLLBACK');
            await metrics.trackPaymentFailed('ADVANCE');
            throw e;
        } finally {
            client.release();
        }
    }

    async processRazorpayWebhook(event) {
        const client = await db.pool.connect();
        try {
            const payload = event.payload || {};
            const eventType = event.event;
            const paymentEntity = payload.payment?.entity;
            const orderEntity = payload.order?.entity;

            const razorpayPaymentId = paymentEntity?.id || null;
            const razorpayOrderId = orderEntity?.id || paymentEntity?.order_id || null;

            await client.query(
                `INSERT INTO razorpay_webhooks (event_type, razorpay_id, payment_id, order_id, raw_payload, status)
                 VALUES ($1, $2, $3, $4, $5, 'RECEIVED')`,
                [eventType, event.id, razorpayPaymentId, razorpayOrderId, JSON.stringify(event)]
            );

            if (eventType === 'payment.captured' && razorpayPaymentId) {
                await client.query('BEGIN');

                const pRes = await client.query(
                    `SELECT p.*, j.category, j.worker_id FROM payments p
                     JOIN jobs j ON j.id = p.job_id
                     WHERE p.gateway_reference = $1 AND p.payment_status = 'PENDING'`,
                    [razorpayPaymentId]
                );

                if (pRes.rowCount > 0) {
                    const payment = pRes.rows[0];

                    await client.query(
                        `UPDATE payments SET payment_status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
                        [payment.id]
                    );

                    if (payment.worker_id) {
                        await this._creditWorkerWithCommission(
                            payment.worker_id, parseFloat(payment.amount), payment.category, payment.job_id,
                            `Earnings for job: ${payment.category} (Razorpay)`, client
                        );
                    }

                    await paymentTrustService.recordSuccessfulPayment(payment.worker_id, 'WORKER');
                    await paymentTrustService.recordSuccessfulPayment(payment.payer_id, 'USER');

                    await metrics.trackPaymentSuccess('ONLINE');
                }

                await client.query(
                    `UPDATE razorpay_webhooks SET status = 'PROCESSED', processed_at = NOW() WHERE payment_id = $1 AND status = 'RECEIVED'`,
                    [razorpayPaymentId]
                );

                await client.query('COMMIT');
            }

            return { success: true };
        } catch (e) {
            await client.query('ROLLBACK');
            await metrics.trackPaymentFailed('ONLINE');
            await client.query(
                `UPDATE razorpay_webhooks SET status = 'FAILED', error = $1 WHERE event_type = $2 AND status = 'RECEIVED'`,
                [e.message, eventType]
            );
            throw e;
        } finally {
            client.release();
        }
    }

    async getPendingCashConfirmations() {
        const res = await db.query(
            `SELECT cc.*, p.worker_id, w.phone_number as worker_phone
             FROM cash_confirmations cc
             JOIN payments p ON p.id = cc.payment_id
             JOIN workers w ON w.id = cc.worker_id
             WHERE cc.status = 'PENDING'
             ORDER BY cc.worker_marked_at ASC`
        );
        return res.rows;
    }

    async disputePayment(paymentId, initiatorId, initiatorRole, reason, description = '') {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const pRes = await client.query(
                `SELECT p.*, j.user_id, j.worker_id FROM payments p
                 JOIN jobs j ON j.id = p.job_id
                 WHERE p.id = $1`,
                [paymentId]
            );
            if (pRes.rowCount === 0) throw new Error("Payment not found");
            const payment = pRes.rows[0];

            if (payment.payment_status === 'DISPUTED') {
                await client.query('COMMIT');
                return { success: false, message: "Payment already disputed" };
            }

            await client.query(
                `UPDATE payments SET payment_status = 'DISPUTED', updated_at = NOW() WHERE id = $1`,
                [paymentId]
            );

            const respondentId = initiatorRole === 'WORKER' ? payment.payer_id : payment.worker_id;

            const disputeService = require('./dispute.service');
            const dispute = await disputeService.createDispute(
                paymentId, payment.job_id, initiatorId, initiatorRole,
                respondentId, reason, description
            );

            await paymentTrustService.recordDispute(initiatorId, initiatorRole);

            await metrics.trackPaymentDisputed(payment.payment_mode);

            await client.query('COMMIT');
            return { success: true, dispute };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

module.exports = new PaymentService();
