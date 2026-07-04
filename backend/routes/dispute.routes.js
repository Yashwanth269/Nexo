const express = require('express');
const router = express.Router();
const paymentService = require('../services/payment.service');
const disputeService = require('../services/dispute.service');

// Raise a dispute on a payment
router.post('/raise', async (req, res) => {
    try {
        const { paymentId, reason, description } = req.body;
        const userId = req.user.userId;
        const role = req.user.role || 'USER';

        if (!paymentId || !reason) {
            return res.status(400).json({ success: false, message: "paymentId and reason are required" });
        }

        const result = await paymentService.disputePayment(paymentId, userId, role, reason, description || '');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Resolve a dispute (admin/support)
router.post('/resolve/:disputeId', async (req, res) => {
    try {
        const { disputeId } = req.params;
        const { resolution } = req.body;
        const resolvedBy = req.user.userId;

        if (!resolution) {
            return res.status(400).json({ success: false, message: "Resolution is required" });
        }

        const dispute = await disputeService.resolveDispute(disputeId, resolvedBy, resolution);
        res.json({ success: true, dispute });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get dispute status
router.get('/status/:disputeId', async (req, res) => {
    try {
        const { disputeId } = req.params;
        const slaStatus = await disputeService.getSlaStatus(disputeId);
        if (!slaStatus) {
            return res.status(404).json({ success: false, message: "Dispute not found" });
        }
        res.json({ success: true, ...slaStatus });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get disputes for current user
router.get('/my', async (req, res) => {
    try {
        const userId = req.user.userId;
        const role = req.user.role || 'USER';
        const disputes = await disputeService.getDisputesByRole(userId, role);
        res.json({ success: true, disputes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
