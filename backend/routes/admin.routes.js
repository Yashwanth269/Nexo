const express = require('express');
const router = express.Router();
const db = require('../config/db');
const shadowBanService = require('../services/shadow_ban.service');
const modelMaturityService = require('../services/model_maturity.service');
const emergencyService = require('../services/emergency.service');

router.get('/heatmap', async (req, res) => {
    try {
        const { hours } = req.query;
        const lookback = hours ? `${hours} hours` : '24 hours';
        const result = await db.query(`
            SELECT snapshot_data, captured_at FROM heatmap_snapshots
            WHERE captured_at > NOW() - INTERVAL '${lookback}'
            ORDER BY captured_at DESC
        `);
        res.json({ success: true, snapshots: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/reliability', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT worker_id, completion_rate, reliability_score, fraud_risk_score, gps_trust_score,
                   fatigue_score, cancellation_rate
            FROM worker_features wf
            ORDER BY reliability_score DESC
            LIMIT 100
        `);
        res.json({ success: true, scores: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/shadow-ban', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT * FROM shadow_ban_status WHERE active = true ORDER BY escalated_at DESC
        `);
        res.json({ success: true, bans: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/shadow-ban/:workerId', async (req, res) => {
    try {
        const { level, reason } = req.body;
        await shadowBanService.setBanLevel(req.params.workerId, level || 1, reason || 'Admin action');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/shadow-ban/:workerId/deescalate', async (req, res) => {
    try {
        await shadowBanService.deescalate(req.params.workerId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/emergency', async (req, res) => {
    try {
        const { priority } = req.query;
        const reports = await emergencyService.getOpenReports(priority || null);
        res.json({ success: true, reports });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/model-maturity', async (req, res) => {
    try {
        const scores = await modelMaturityService.getAllMaturityScores();
        res.json({ success: true, scores });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
