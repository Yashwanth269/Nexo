const express = require('express');
const router = express.Router();
const emergencyService = require('../services/emergency.service');

router.post('/report', async (req, res) => {
    try {
        const { reportType, description, lat, lng, jobId } = req.body;
        const reporterId = req.user.userId;
        const reporterRole = req.user.role || 'USER';
        if (!reportType || !description) {
            return res.status(400).json({ success: false, message: "reportType and description are required" });
        }
        const report = await emergencyService.createReport(reporterId, reporterRole, reportType, description, lat, lng, jobId);
        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/queue', async (req, res) => {
    try {
        const { priority } = req.query;
        const reports = await emergencyService.getOpenReports(priority || null);
        res.json({ success: true, reports });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:reportId/acknowledge', async (req, res) => {
    try {
        const adminId = req.user.userId;
        await emergencyService.acknowledgeReport(req.params.reportId, adminId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:reportId/resolve', async (req, res) => {
    try {
        const { resolution } = req.body;
        await emergencyService.resolveReport(req.params.reportId, resolution);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
