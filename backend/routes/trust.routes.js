const express = require('express');
const router = express.Router();
const userTrustService = require('../services/user_trust.service');

router.get('/score', async (req, res) => {
    try {
        const userId = req.user.userId;
        const score = await userTrustService.getOrCreateScore(userId);
        res.json({ success: true, score });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
