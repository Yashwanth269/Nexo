const rateLimit = require('express-rate-limit');
const securityService = require('../services/security.service');
const db = require('../config/db');

/**
 * Global Rate Limiter
 * limit: 100 requests per minute per IP
 */
const globalRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100,
    message: { success: false, error: "Too many requests, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Security Tracking Middleware
 */
const securityMiddleware = async (req, res, next) => {
    // Capture metadata
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceId = req.headers['x-device-id'] || 'unknown_device';

    req.security = {
        ip,
        userAgent,
        deviceId,
        fingerprint: securityService.generateFingerprint(ip, deviceId, userAgent)
    };

    // If user is authenticated, log session and calculate risk
    if (req.user && (req.user.userId || req.user.workerId)) {
        const userId = req.user.userId || req.user.workerId;
        const fingerprint = req.security.fingerprint;
        
        // Log Session
        db.query(
            "INSERT INTO login_sessions (user_id, ip_address, device_id, user_agent, fingerprint) VALUES ($1, $2, $3, $4, $5)",
            [userId, ip, deviceId, userAgent, fingerprint]
        ).catch(e => console.error("Session Log Error:", e));

        // Calculate Risk Score
        const riskScore = await securityService.calculateRiskScore(
            userId, 
            ip, 
            deviceId, 
            req.security.fingerprint
        );
        
        req.security.riskScore = riskScore;
        req.security.riskLevel = riskScore < 0.3 ? 'SAFE' : (riskScore < 0.7 ? 'MEDIUM' : 'HIGH_RISK');

        // Audit High Risk
        if (req.security.riskLevel === 'HIGH_RISK') {
            securityService.logSecurityEvent(userId, 'HIGH_RISK_ACTIVITY', ip, riskScore, {
                deviceId,
                fingerprint: req.security.fingerprint,
                reason: 'Abnormal behavior detected'
            });
        }
    }

    next();
};

module.exports = {
    globalRateLimiter,
    securityMiddleware
};
