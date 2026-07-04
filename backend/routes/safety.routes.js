const express = require('express');
const router = express.Router();
const safetyService = require('../services/safety.service');

/**
 * @route POST /api/safety/report
 * @desc Report a safety incident
 */
router.post('/report', async (req, res) => {
    try {
        const { jobId, reporterId, reporterType, reason, description, lat, lng } = req.body;
        const result = await safetyService.reportIncident(jobId, reporterId, reporterType, reason, description, lat, lng);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/safety/sos
 * @desc Trigger Emergency SOS
 */
router.post('/sos', async (req, res) => {
    try {
        const { workerId, jobId, lat, lng } = req.body;
        const result = await safetyService.triggerSOS(workerId, jobId, lat, lng);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
