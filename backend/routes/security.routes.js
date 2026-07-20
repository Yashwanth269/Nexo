/**
 * Nexo Security & Identity Verification REST Endpoints
 */

const express = require('express');
const router = express.Router();
const selfieService = require('../services/selfie_verification.service');

// Trigger Selfie Check
router.post('/trigger-selfie', async (req, res) => {
    try {
        const { workerId, reason } = req.body;
        if (!workerId) return res.status(400).json({ success: false, error: "workerId is required" });
        
        const result = await selfieService.triggerVerification(workerId, reason || 'SECURITY_CHECK');
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Submit Captured Selfie for Verification
router.post('/selfie-verify', async (req, res) => {
    try {
        const { workerId, verificationId, s3Key, confidenceScore } = req.body;
        if (!workerId || !verificationId) {
            return res.status(400).json({ success: false, error: "workerId and verificationId are required" });
        }

        const result = await selfieService.submitSelfie(workerId, verificationId, {
            s3Key: s3Key || `selfies/${workerId}/${Date.now()}.jpg`,
            confidenceScore: confidenceScore || 92.5
        });

        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
