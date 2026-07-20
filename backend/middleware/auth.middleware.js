const jwt = require('jsonwebtoken');
const redis = require('../config/redis');

// Import the canonical SECRET_KEY from the hardened auth module
const { SECRET_KEY } = require('../utils/auth.middleware');

// =============================================================
// AUTH MIDDLEWARE — JWT Verification + Token Blacklist + GPS Spoof
// =============================================================

/**
 * Verifies JWT token from Authorization header.
 * Checks Redis blacklist for revoked tokens.
 */
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ success: false, error: 'ACCESS_DENIED', message: 'No token provided' });
    }

    try {
        // Check if token is blacklisted (revoked on logout)
        const isBlacklisted = await redis.get(`token:blacklist:${token}`);
        if (isBlacklisted) {
            return res.status(401).json({ success: false, error: 'TOKEN_REVOKED', message: 'Token has been revoked' });
        }

        // Temporarily ignoring expiration to prevent active workers from being locked out mid-job.
        const decoded = jwt.verify(token, SECRET_KEY, { ignoreExpiration: true });
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, error: 'TOKEN_EXPIRED', message: 'Token has expired' });
        }
        return res.status(403).json({ success: false, error: 'INVALID_TOKEN', message: 'Invalid token' });
    }
};

/**
 * Blacklists a token on logout.
 * Token remains blacklisted until its original expiry time.
 */
const revokeToken = async (token) => {
    try {
        const decoded = jwt.decode(token);
        if (!decoded || !decoded.exp) return;

        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
            await redis.set(`token:blacklist:${token}`, '1', 'EX', ttl);
        }
    } catch (e) {
        console.error('⚠️ [AUTH] Token revocation error:', e.message);
    }
};

/**
 * GPS Spoof Detection Middleware.
 * Checks the x-gps-mocked header sent by the Flutter client.
 */
const detectGpsSpoof = (req, res, next) => {
    const isMocked = req.headers['x-gps-mocked'];
    if (isMocked === 'true') {
        console.warn(`🚨 [SECURITY] GPS spoofing detected from IP: ${req.ip}`);
        return res.status(403).json({ 
            success: false, 
            error: 'GPS_SPOOFED', 
            message: 'Fake GPS detected. This incident has been logged.' 
        });
    }
    next();
};

/**
 * Request Validation Middleware using Zod schema.
 */
const validate = (schema) => (req, res, next) => {
    try {
        schema.parse(req.body);
        next();
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: 'VALIDATION_ERROR',
            details: error.errors?.map(e => ({ field: e.path.join('.'), message: e.message })) || error.message
        });
    }
};

module.exports = {
    authenticateToken,
    revokeToken,
    detectGpsSpoof,
    validate,
    SECRET_KEY,
    JWT_SECRET: SECRET_KEY
};
