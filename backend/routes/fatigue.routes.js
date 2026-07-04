const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/score', async (req, res) => {
    try {
        const workerId = req.user.userId;
        const result = await db.query(
            "SELECT * FROM advanced_fatigue_scores WHERE worker_id = $1",
            [workerId]
        );
        if (result.rowCount === 0) {
            return res.json({ success: true, score: null, message: "No fatigue data available" });
        }
        res.json({ success: true, score: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
