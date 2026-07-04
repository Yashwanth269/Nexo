const express = require('express');
const router = express.Router();
const backupWorkerService = require('../services/backup_worker.service');

router.get('/status/:jobId', async (req, res) => {
    try {
        const backups = await backupWorkerService.getBackupStatus(req.params.jobId);
        res.json({ success: true, backups });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/reserve', async (req, res) => {
    try {
        const { jobId, primaryWorkerId, count } = req.body;
        if (!jobId) {
            return res.status(400).json({ success: false, message: "jobId is required" });
        }
        const backups = await backupWorkerService.reserveBackups(jobId, primaryWorkerId, count || 2);
        res.json({ success: true, backups });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/activate/:jobId', async (req, res) => {
    try {
        const { reason } = req.body;
        const backup = await backupWorkerService.activateBackup(req.params.jobId, reason || 'Manual activation');
        if (!backup) {
            return res.status(404).json({ success: false, message: "No backup worker available" });
        }
        res.json({ success: true, backup });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
