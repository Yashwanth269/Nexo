const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const securityService = require('../services/security.service');
const { SECRET_KEY } = require('../utils/auth.middleware');
const { sendOTP, verifyOTP } = require('../config/otp');
const { otpLimiter } = require('../middleware/rate-limits');

// Send OTP
router.post('/send-otp', otpLimiter, async (req, res) => {
    const { phoneNumber } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    if (!phoneNumber) return res.status(400).json({ success: false, message: "Phone number required" });

    try {
        const result = await sendOTP(phoneNumber, ip);
        if (!result.success) {
            return res.status(429).json(result);
        }
        res.json(result);
    } catch (e) {
        console.error("❌ [WORKER-SEND-OTP ERROR]", e.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Verify OTP
router.post('/verify-otp', otpLimiter, async (req, res) => {
    try {
        const { phoneNumber, otp, lat, lng } = req.body;
        
        const verifyResult = await verifyOTP(phoneNumber, otp);
        if (!verifyResult.success) {
            return res.status(401).json(verifyResult);
        }
        
        // Check DB for worker
        let workerId;
        let isProfileComplete = false;
        const result = await db.query("SELECT id, is_profile_complete FROM workers WHERE phone_number = $1", [phoneNumber]);
        
        if (result.rowCount > 0) {
            workerId = result.rows[0].id;
            isProfileComplete = result.rows[0].is_profile_complete;
        } else {
            // Create new worker, using phone number as default name to satisfy NOT NULL constraint
            const insertResult = await db.query(
                "INSERT INTO workers (phone_number, full_name) VALUES ($1, $2) RETURNING id",
                [phoneNumber, `Worker ${phoneNumber.slice(-4)}`]
            );
            workerId = insertResult.rows[0].id;
        }

        // --- Security Analysis ---
        const ip = req.ip || req.connection.remoteAddress;
        const deviceId = req.headers['x-device-id'] || 'unknown';
        const userAgent = req.headers['user-agent'];
        const fingerprint = req.headers['x-fingerprint'] || 'unknown';

        const riskScore = await securityService.calculateRiskScore(workerId, ip, deviceId, fingerprint);
        const anomaly = (lat && lng) ? await securityService.detectAnomaly(workerId, lat, lng, ip) : false;
        
        let finalRiskScore = riskScore;
        if (anomaly) finalRiskScore = Math.min(finalRiskScore + 0.4, 1.0);

        const riskLevel = finalRiskScore < 0.3 ? 'SAFE' : (finalRiskScore < 0.7 ? 'MEDIUM' : 'HIGH_RISK');

        // Log security event
        await securityService.logSecurityEvent(workerId, anomaly ? 'WORKER_LOGIN_ANOMALY' : 'WORKER_LOGIN_SUCCESS', ip, finalRiskScore, {
            deviceId,
            fingerprint,
            userAgent,
            location: { lat, lng },
            anomaly
        });

        if (riskLevel === 'HIGH_RISK') {
            return res.status(403).json({ 
                success: false, 
                error: "HIGH_RISK_DETECTED", 
                message: "Security threat detected. Access blocked." 
            });
        }

        // Update last login GPS
        if (lat && lng) {
            await db.query("UPDATE workers SET last_login_gps = $1 WHERE id = $2", [JSON.stringify({ lat, lng }), workerId]);
        }

        const token = jwt.sign({ phoneNumber, workerId, role: 'WORKER' }, SECRET_KEY, { expiresIn: '7d' });
        
        // Fetch profile details for session hydration
        const profile = await db.query("SELECT full_name, photo_url FROM workers WHERE id = $1", [workerId]);
        
        res.json({ 
            success: true, 
            token, 
            workerId,
            isProfileComplete,
            workerName: profile.rows[0]?.full_name || null,
            workerPhoto: profile.rows[0]?.photo_url || null,
            security: { riskLevel, riskScore: finalRiskScore }
        });
    } catch (error) {
        console.error("Worker Auth Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

module.exports = router;
