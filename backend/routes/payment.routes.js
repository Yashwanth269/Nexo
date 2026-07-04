const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const paymentService = require('../services/payment.service');
const payoutService = require('../services/payout.service');
const walletService = require('../services/wallet.service');
const { walletLimiter, payoutLimiter } = require('../middleware/rate-limits');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_T1woiscWDbu4xf',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '2VS48ffmS4MfLPaH5zr5S4DQ'
});

// Create a payment record (Checkouts / online payments / cash setup)
router.post('/create', walletLimiter, async (req, res) => {
    try {
        const { jobId, amount, paymentMode, gatewayReference } = req.body;
        const userId = req.user.userId;

        if (!userId) {
            return res.status(400).json({ success: false, message: "User authentication required" });
        }

        if (paymentMode === 'ONLINE') {
            const ref = gatewayReference || `pay_sim_${Date.now()}`;
            const result = await paymentService.processOnlineJobPayment(jobId, parseFloat(amount), ref);
            return res.json(result);
        } else if (paymentMode === 'WALLET') {
            const db = require('../config/db');
            const jRes = await db.query("SELECT worker_id FROM jobs WHERE id = $1", [jobId]);
            if (jRes.rowCount === 0) {
                return res.status(400).json({ success: false, message: "Job not found" });
            }
            const workerId = jRes.rows[0].worker_id;

            await walletService.deductFunds(
                userId, 'USER', parseFloat(amount), 'DEBIT', jobId,
                `Payment for job: ${jobId}`
            );

            const payment = await paymentService.createPayment(jobId, userId, workerId, parseFloat(amount), 'WALLET');
            await db.query("UPDATE payments SET payment_status = 'SUCCESS' WHERE id = $1", [payment.id]);

            if (workerId) {
                const commissionService = require('../services/commission.service');
                const { platformFee } = await commissionService.computeCommission(parseFloat(amount), 'OTHER');
                const jCat = await db.query("SELECT category FROM jobs WHERE id = $1", [jobId]);
                const category = jCat.rows[0]?.category || 'OTHER';
                const { platformFee: pf } = await commissionService.computeCommission(parseFloat(amount), category);

                await walletService.addFunds(workerId, 'WORKER', parseFloat(amount), 'EARNING', jobId, `Job payment from wallet`);
                await walletService.deductFunds(workerId, 'WORKER', pf, 'COMMISSION', jobId, `Platform commission (${category})`);
            }

            const executionService = require('../services/execution.service');
            await executionService.transitionStatus(jobId, workerId, 'COMPLETED', { paymentMethod: 'WALLET' });

            const metrics = require('../middleware/metrics');
            await metrics.trackPaymentSuccess('WALLET');

            return res.json({ success: true, payment });
        } else if (paymentMode === 'CASH') {
            const db = require('../config/db');
            const jRes = await db.query("SELECT worker_id FROM jobs WHERE id = $1", [jobId]);
            if (jRes.rowCount === 0) {
                return res.status(400).json({ success: false, message: "Job not found" });
            }
            const workerId = jRes.rows[0].worker_id;

            const payment = await paymentService.createPayment(jobId, userId, workerId, parseFloat(amount), 'CASH');

            const executionService = require('../services/execution.service');
            await executionService.transitionStatus(jobId, workerId, 'COMPLETED', { paymentMethod: 'CASH' });

            return res.json({ success: true, payment, note: "Worker must mark cash as received via POST /api/payment/mark-cash-received" });
        } else if (paymentMode === 'PARTIAL') {
            const { advanceAmount, remainingCashAmount } = req.body;
            if (advanceAmount === undefined || remainingCashAmount === undefined) {
                return res.status(400).json({ success: false, message: "advanceAmount and remainingCashAmount are required for partial payments" });
            }
            const ref = gatewayReference || `pay_sim_${Date.now()}`;
            const result = await paymentService.processPartialPayment(
                jobId, parseFloat(advanceAmount), parseFloat(remainingCashAmount), ref
            );

            const db = require('../config/db');
            const jRes = await db.query("SELECT worker_id FROM jobs WHERE id = $1", [jobId]);
            const workerId = jRes.rows[0]?.worker_id;

            const executionService = require('../services/execution.service');
            await executionService.transitionStatus(jobId, workerId, 'COMPLETED', { paymentMethod: 'PARTIAL' });

            return res.json(result);
        } else {
            return res.status(400).json({ success: false, message: "Unsupported payment mode" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Worker marks cash as received (triggers dual confirmation flow)
router.post('/mark-cash-received', async (req, res) => {
    try {
        const { paymentId } = req.body;
        const workerId = req.user.workerId;

        if (!workerId) {
            return res.status(400).json({ success: false, message: "Worker authentication required" });
        }

        const result = await paymentService.workerMarksCashReceived(paymentId, workerId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// User confirms cash payment (completes dual confirmation flow)
router.post('/confirm-cash', async (req, res) => {
    try {
        const { paymentId } = req.body;
        const userId = req.user.userId;

        if (!userId) {
            return res.status(400).json({ success: false, message: "User authentication required" });
        }

        const result = await paymentService.confirmCashPayment(paymentId, userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Razorpay Webhook endpoint (NO authentication - Razorpay signature verified)
router.post('/webhook', async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (webhookSecret) {
            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(JSON.stringify(req.body))
                .digest('hex');
            const receivedSignature = req.headers['x-razorpay-signature'];
            if (expectedSignature !== receivedSignature) {
                return res.status(401).json({ success: false, message: "Invalid webhook signature" });
            }
        }

        const result = await paymentService.processRazorpayWebhook(req.body);
        res.json(result);
    } catch (error) {
        console.error("[WEBHOOK] Error processing Razorpay webhook:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Request withdrawal payout (Worker action)
router.post('/withdraw', payoutLimiter, async (req, res) => {
    try {
        const { amount, bankDetails, idempotencyKey } = req.body;
        const workerId = req.user.workerId;

        if (!workerId) {
            return res.status(400).json({ success: false, message: "Worker authentication required" });
        }

        const result = await payoutService.requestWithdrawal(workerId, parseFloat(amount), bankDetails || {}, idempotencyKey);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get worker payout history
router.get('/payouts', async (req, res) => {
    try {
        const workerId = req.user.workerId;
        if (!workerId) {
            return res.status(400).json({ success: false, message: "Worker authentication required" });
        }

        const payouts = await payoutService.getWorkerPayouts(workerId);
        res.json({ success: true, payouts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Simulate payout resolution (Dev only)
router.post('/simulate-payout-resolution', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ success: false, message: 'Not Found' });
    }
    try {
        const { payoutId, status, utr, reason } = req.body;

        let result;
        if (status === 'SUCCESS') {
            result = await payoutService.payoutSuccess(payoutId, utr || `utr_${Date.now()}`);
        } else {
            result = await payoutService.payoutFailed(payoutId, reason || 'Simulated failure');
        }
        res.json({ success: true, payout: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Razorpay Order
router.post('/create-order', async (req, res) => {
    try {
        const { amount, currency, receipt } = req.body;

        if (!amount || amount < 100) {
            return res.status(400).json({ success: false, message: "Amount must be at least 100 paise (₹1)" });
        }

        const options = {
            amount: Math.round(amount),
            currency: currency || "INR",
            receipt: receipt || `receipt_${Date.now()}`
        };

        const order = await razorpay.orders.create(options);

        res.json({
            success: true,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency
        });
    } catch (error) {
        console.error("Error creating Razorpay order:", error);
        res.status(500).json({ success: false, message: "Razorpay order creation failed", error: error.message });
    }
});

// Verify Razorpay Signature
router.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, jobId } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Missing required verification fields" });
        }

        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '2VS48ffmS4MfLPaH5zr5S4DQ')
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest('hex');

        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: "Signature verification failed" });
        }

        if (jobId) {
            const db = require('../config/db');
            const pCheck = await db.query(
                `SELECT * FROM payments WHERE gateway_reference = $1`,
                [razorpay_payment_id]
            );

            if (pCheck.rowCount === 0) {
                const jRes = await db.query("SELECT price, worker_id FROM jobs WHERE id = $1", [jobId]);
                if (jRes.rowCount > 0) {
                    const price = parseFloat(jRes.rows[0].price);
                    const workerId = jRes.rows[0].worker_id;
                    await paymentService.processOnlineJobPayment(jobId, price, razorpay_payment_id);

                    const executionService = require('../services/execution.service');
                    await executionService.transitionStatus(jobId, workerId, 'COMPLETED', {
                        paymentMethod: 'ONLINE',
                        paymentVerified: true
                    });
                }
            }
        }

        res.json({ success: true, message: "Payment verified successfully" });
    } catch (error) {
        console.error("Error verifying payment signature:", error);
        res.status(500).json({ success: false, message: "Payment verification failed", error: error.message });
    }
});

// Get Razorpay Key ID
router.get('/razorpay-key', (req, res) => {
    res.json({ keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_T1woiscWDbu4xf' });
});

// Check payment status for a job
router.get('/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const db = require('../config/db');

        const result = await db.query(
            `SELECT * FROM payments WHERE job_id = $1 AND payment_status = 'SUCCESS'`,
            [jobId]
        );

        if (result.rowCount > 0) {
            return res.json({ success: true, paid: true, payment: result.rows[0] });
        } else {
            return res.json({ success: true, paid: false });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Razorpay UPI QR Code
router.post('/create-qr', async (req, res) => {
    try {
        const { jobId, amount } = req.body;

        if (!jobId || !amount) {
            return res.status(400).json({ success: false, message: "jobId and amount are required" });
        }

        const amtPaise = Math.round(parseFloat(amount) * 100);

        let qrCodeUrl = "";
        let qrCodeId = "";

        try {
            const qrCode = await razorpay.qrCode.create({
                type: "upi_qr",
                name: "Flex Marketplace",
                usage: "single_use",
                fixed_amount: true,
                amount: amtPaise,
                description: `Job Payment ${jobId}`,
                notes: { job_id: jobId }
            });

            qrCodeUrl = qrCode.image_url;
            qrCodeId = qrCode.id;
        } catch (rzpError) {
            console.warn("⚠️ [RAZORPAY_QR] Failed to create QR Code via Razorpay API, using UPI intent fallback:", rzpError.message);
            const upiIntent = `upi://pay?pa=flexmarket@icici&pn=FlexMarketplace&am=${parseFloat(amount).toFixed(2)}&cu=INR&tn=Job_${jobId}`;
            qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(upiIntent)}`;
            qrCodeId = `qr_fallback_${Date.now()}`;
        }

        const db = require('../config/db');
        const jRes = await db.query("SELECT worker_id, user_id FROM jobs WHERE id = $1", [jobId]);
        if (jRes.rowCount > 0) {
            const { worker_id, user_id } = jRes.rows[0];
            const pCheck = await db.query(
                `SELECT id FROM payments WHERE job_id = $1 AND payment_mode = 'ONLINE'`,
                [jobId]
            );
            if (pCheck.rowCount === 0) {
                await db.query(
                    `INSERT INTO payments (job_id, payer_id, worker_id, amount, payment_mode, payment_status, gateway_reference)
                     VALUES ($1, $2, $3, $4, 'ONLINE', 'PENDING', $5)`,
                    [jobId, user_id, worker_id, parseFloat(amount), qrCodeId]
                );
            }
        }

        res.json({
            success: true,
            qr_code_url: qrCodeUrl,
            qr_code_id: qrCodeId
        });
    } catch (error) {
        console.error("Error creating QR Code:", error);
        res.status(500).json({ success: false, message: "QR Code creation failed", error: error.message });
    }
});

// Verify/Simulate QR Payment Completion
router.post('/verify-qr', async (req, res) => {
    try {
        const { jobId, qrCodeId } = req.body;

        if (!jobId) {
            return res.status(400).json({ success: false, message: "jobId is required" });
        }

        const db = require('../config/db');

        const pRes = await db.query(
            `SELECT * FROM payments WHERE job_id = $1 AND payment_mode = 'ONLINE'`,
            [jobId]
        );

        if (pRes.rowCount === 0) {
            return res.status(400).json({ success: false, message: "Payment record not found" });
        }

        const payment = pRes.rows[0];

        if (payment.payment_status === 'SUCCESS') {
            return res.json({ success: true, message: "Payment already verified successfully" });
        }

        await db.query(
            `UPDATE payments SET payment_status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
            [payment.id]
        );

        const paymentService = require('../services/payment.service');
        const jRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
        if (jRes.rowCount > 0) {
            const job = jRes.rows[0];
            const amount = parseFloat(payment.amount);

            if (job.worker_id) {
                const commissionService = require('../services/commission.service');
                const { platformFee } = await commissionService.computeCommission(amount, job.category || 'OTHER');

                await walletService.addFunds(
                    job.worker_id, 'WORKER', amount, 'EARNING', jobId,
                    `Earnings for job: ${job.category}`
                );

                await walletService.deductFunds(
                    job.worker_id, 'WORKER', platformFee, 'COMMISSION', jobId,
                    `Platform fee for job: ${job.category}`
                );
            }

            const executionService = require('../services/execution.service');
            await executionService.transitionStatus(jobId, job.worker_id, 'COMPLETED', {
                paymentMethod: 'ONLINE',
                paymentVerified: true
            });
        }

        res.json({ success: true, message: "Payment verified successfully" });
    } catch (error) {
        console.error("Error verifying QR payment:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
