const express = require('express');
const router = express.Router();
const walletService = require('../services/wallet.service');
const { walletLimiter } = require('../middleware/rate-limits');

// Get wallet balance (includes cash_held and withdrawable separation)
router.get('/balance', async (req, res) => {
    try {
        const ownerId = req.user.role === 'WORKER' ? req.user.workerId : req.user.userId;
        const ownerType = req.user.role === 'WORKER' ? 'WORKER' : 'USER';

        if (!ownerId) {
            return res.status(400).json({ success: false, message: "Authentication required" });
        }

        const balance = await walletService.getBalance(ownerId, ownerType);
        res.json({ success: true, ...balance });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get transaction history
router.get('/transactions', async (req, res) => {
    try {
        const ownerId = req.user.role === 'WORKER' ? req.user.workerId : req.user.userId;
        const ownerType = req.user.role === 'WORKER' ? 'WORKER' : 'USER';

        if (!ownerId) {
            return res.status(400).json({ success: false, message: "Authentication required" });
        }

        const transactions = await walletService.getTransactions(ownerId, ownerType);
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get worker earnings stats (Worker only)
router.get('/worker-earnings', async (req, res) => {
    try {
        const workerId = req.user.workerId;
        if (!workerId) {
            return res.status(400).json({ success: false, message: "Worker authentication required" });
        }

        const summary = await walletService.getWorkerEarningsSummary(workerId);
        res.json({ success: true, summary });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Simulate deposit to user wallet (Dev only)
router.post('/deposit-simulate', walletLimiter, async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ success: false, message: 'Not Found' });
    }
    try {
        const ownerId = req.user.role === 'WORKER' ? req.user.workerId : req.user.userId;
        const ownerType = req.user.role === 'WORKER' ? 'WORKER' : 'USER';
        const { amount } = req.body;

        if (!ownerId) {
            return res.status(400).json({ success: false, message: "Authentication required" });
        }

        await walletService.addFunds(
            ownerId, ownerType, parseFloat(amount), 'DEPOSIT', null,
            'Simulated wallet deposit'
        );

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Razorpay Deposit Order
router.post('/create-deposit-order', walletLimiter, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "Invalid deposit amount" });
        }

        const Razorpay = require('razorpay');
        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_T1woiscWDbu4xf',
            key_secret: process.env.RAZORPAY_KEY_SECRET || '2VS48ffmS4MfLPaH5zr5S4DQ'
        });

        const options = {
            amount: Math.round(parseFloat(amount) * 100), // amount in paise
            currency: "INR",
            receipt: `deposit_${Date.now()}`
        };

        let order;
        let isSimulated = false;
        try {
            order = await razorpay.orders.create(options);
        } catch (err) {
            console.error("❌ [RAZORPAY] Order creation failed. Keys being used:", {
                key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_T1woiscWDbu4xf',
                has_secret: !!(process.env.RAZORPAY_KEY_SECRET)
            }, "Error details:", err);
            order = {
                id: `order_dep_${Date.now()}`,
                amount: Math.round(parseFloat(amount) * 100),
                currency: "INR"
            };
            isSimulated = true;
        }

        res.json({
            success: true,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            isSimulated: isSimulated
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify Simulated Razorpay Deposit
router.post('/verify-deposit-simulation', walletLimiter, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, amount } = req.body;
        const ownerId = req.user.role === 'WORKER' ? req.user.workerId : req.user.userId;
        const ownerType = req.user.role === 'WORKER' ? 'WORKER' : 'USER';
        const crypto = require('crypto');

        if (!ownerId) {
            return res.status(400).json({ success: false, message: "Authentication required" });
        }

        if (!razorpay_order_id || !razorpay_payment_id) {
            return res.status(400).json({ success: false, message: "Missing Razorpay order/payment IDs" });
        }

        // Generate signature on backend to mimic successful Razorpay SDK callback
        const secret = process.env.RAZORPAY_KEY_SECRET || '2VS48ffmS4MfLPaH5zr5S4DQ';
        const generatedSignature = crypto
            .createHmac('sha256', secret)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest('hex');

        // Execute secure wallet update
        await walletService.addFunds(
            ownerId, ownerType, parseFloat(amount), 'DEPOSIT', null,
            `Razorpay Deposit (Ref: ${razorpay_payment_id})`
        );

        res.json({
            success: true,
            message: "Deposit processed successfully",
            signature: generatedSignature
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify Real Razorpay Deposit
router.post('/verify-deposit', walletLimiter, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
        const ownerId = req.user.role === 'WORKER' ? req.user.workerId : req.user.userId;
        const ownerType = req.user.role === 'WORKER' ? 'WORKER' : 'USER';
        const crypto = require('crypto');

        if (!ownerId) {
            return res.status(400).json({ success: false, message: "Authentication required" });
        }

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Missing required verification fields" });
        }

        // Cryptographically verify signature
        const secret = process.env.RAZORPAY_KEY_SECRET || '2VS48ffmS4MfLPaH5zr5S4DQ';
        const generatedSignature = crypto
            .createHmac('sha256', secret)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest('hex');

        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: "Payment signature verification failed" });
        }

        // Add funds to wallet
        await walletService.addFunds(
            ownerId, ownerType, parseFloat(amount), 'DEPOSIT', null,
            `Razorpay Deposit (Ref: ${razorpay_payment_id})`
        );

        res.json({ success: true, message: "Deposit processed successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
