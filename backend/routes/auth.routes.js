const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { authenticateToken, revokeToken } = require('../middleware/auth.middleware');
const { SECRET_KEY } = require('../utils/auth.middleware');
const securityService = require('../services/security.service');
const { sendOTP, verifyOTP } = require('../config/otp');
const db = require('../config/db');

// Send OTP endpoint
router.post('/send-otp', async (req, res) => {
    const { phoneNumber } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    
    if (!phoneNumber) return res.status(400).json({ success: false, error: 'Phone number is required' });
    
    try {
        const result = await sendOTP(phoneNumber, ip);
        if (!result.success) {
            return res.status(429).json(result);
        }
        res.json(result);
    } catch (e) {
        console.error("❌ [SEND-OTP ERROR]", e.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Verify OTP endpoint
router.post('/verify-otp', async (req, res) => {
    try {
        const { phoneNumber, otp } = req.body;
        
        const verifyResult = await verifyOTP(phoneNumber, otp);
        if (!verifyResult.success) {
            return res.status(400).json(verifyResult);
        }
        
        // Check DB for user
        let userId;
        const result = await db.query("SELECT id FROM users WHERE phone_number = $1", [phoneNumber]);
        
        let isNewUser = false;
        if (result.rowCount > 0) {
            userId = result.rows[0].id;
        } else {
            // Create new user in DB
            isNewUser = true;
            const insertResult = await db.query(
                "INSERT INTO users (phone_number) VALUES ($1) RETURNING id",
                [phoneNumber]
            );
            userId = insertResult.rows[0].id;
            console.log(`🆕 [AUTH] Created new user: ${userId} for ${phoneNumber}`);
        }

        // --- Security Analysis ---
        const { lat, lng } = req.body;
        const ip = req.ip || req.connection.remoteAddress;
        const deviceId = req.headers['x-device-id'] || 'unknown';
        const userAgent = req.headers['user-agent'];
        const fingerprint = req.headers['x-fingerprint'] || 'unknown';

        const riskScore = await securityService.calculateRiskScore(userId, ip, deviceId, fingerprint);
        const anomaly = (lat && lng) ? await securityService.detectAnomaly(userId, lat, lng, ip) : false;
        
        let finalRiskScore = riskScore;
        if (anomaly) finalRiskScore = Math.min(finalRiskScore + 0.4, 1.0);

        const riskLevel = finalRiskScore < 0.3 ? 'SAFE' : (finalRiskScore < 0.7 ? 'MEDIUM' : 'HIGH_RISK');

        // Log the login event
        await securityService.logSecurityEvent(userId, anomaly ? 'LOGIN_ANOMALY' : 'LOGIN_SUCCESS', ip, finalRiskScore, {
            deviceId,
            fingerprint,
            userAgent,
            location: { lat, lng },
            anomaly
        });

        // Block if High Risk
        if (riskLevel === 'HIGH_RISK') {
            return res.status(403).json({ 
                success: false, 
                error: "HIGH_RISK_DETECTED", 
                message: "This login attempt has been blocked for security reasons. Please contact support." 
            });
        }

        // Update last login GPS
        if (lat && lng) {
            await db.query("UPDATE users SET last_login_gps = $1 WHERE id = $2", [JSON.stringify({ lat, lng }), userId]);
        }

        // Generate Secure JWT
        const token = jwt.sign({ phoneNumber, userId, role: 'USER' }, SECRET_KEY, { expiresIn: '7d' });
        
        res.json({ 
            success: true, 
            token, 
            phoneNumber, 
            userId, 
            isNewUser,
            security: {
                riskLevel,
                riskScore: finalRiskScore
            }
        });
    } catch (error) {
        console.error("❌ [VERIFY-OTP ERROR]", error.message);
        res.status(500).json({ success: false, error: "Internal server error during verification" });
    }
});

// Logout from all devices
router.post('/logout-all', authenticateToken, async (req, res) => {
    // Revoke the current token using the new middleware
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        await revokeToken(token);
    }
    res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
