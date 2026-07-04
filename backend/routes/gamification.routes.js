const express = require('express');
const router = express.Router();
const gamificationService = require('../services/gamification.service');

router.get('/achievements', async (req, res) => {
    try {
        const workerId = req.user.userId;
        const achievements = await gamificationService.getWorkerAchievements(workerId);
        res.json({ success: true, achievements });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/leaderboard', async (req, res) => {
    try {
        const { category, limit } = req.query;
        const leaderboard = await gamificationService.getLeaderboard(category || null, parseInt(limit) || 20);
        res.json({ success: true, leaderboard });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/evaluate', async (req, res) => {
    try {
        const workerId = req.body.workerId || req.user.userId;
        const result = await gamificationService.evaluateWorker(workerId);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
