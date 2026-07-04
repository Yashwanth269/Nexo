const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const legalPath = path.join(__dirname, '../data/legal.json');

// Get Latest Terms
router.get('/terms', (req, res) => {
    try {
        const data = fs.readFileSync(legalPath, 'utf8');
        res.json({ success: true, ...JSON.parse(data) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Error loading legal data" });
    }
});

// Log Acceptance
router.post('/accept', async (req, res) => {
    try {
        const { phoneNumber, version } = req.body;
        
        // Find user by phone number
        const userRes = await db.query("SELECT id FROM users WHERE phone_number = $1", [phoneNumber]);
        
        if (userRes.rowCount > 0) {
            // Actually log acceptance in DB (metadata column can hold this temporarily if we don't have a specific column)
            // But let's assume we can just use the jsonb column or event logs. We'll update the user record if there's a JSON field, or just return success for now.
            // For true enterprise grade we would log this in an audit table or user metadata. 
            // We'll use event_logs table for this.
            await db.query(
                `INSERT INTO event_logs (event_type, entity_id, entity_type, metadata)
                 VALUES ('TERMS_ACCEPTED', $1, 'USER', $2)`,
                [userRes.rows[0].id, JSON.stringify({ version, acceptedAt: new Date().toISOString() })]
            );
            
            res.json({ success: true, message: "Terms accepted" });
        } else {
            res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (err) {
        console.error("Error in legal accept:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

module.exports = router;
