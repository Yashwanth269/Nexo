const express = require('express');
const router = express.Router();
const ratingService = require('../services/rating.service');

// Rate User (by Worker)
router.post('/user', async (req, res) => {
    try {
        const { jobId, workerId, userId, rating, tags, feedback } = req.body;
        const result = await ratingService.rateUser(jobId, workerId, userId, rating, tags, feedback);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rate Worker (by User)
router.post('/worker', async (req, res) => {
    try {
        const { jobId, userId, workerId, rating, tags, feedback } = req.body;
        const result = await ratingService.rateWorker(jobId, userId, workerId, rating, tags, feedback);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
