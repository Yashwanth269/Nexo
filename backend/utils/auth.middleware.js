const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// =============================================================
// AUTH MIDDLEWARE — Production-Grade JWT Verification
// CRITICAL: App MUST crash if JWT_SECRET is not configured.
// =============================================================

const SECRET_KEY = process.env.JWT_SECRET;

if (!SECRET_KEY) {
    console.error('🚨 [FATAL] JWT_SECRET environment variable is NOT set. Cannot start server without it.');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'base64\'))"');
    process.exit(1);
}

if (SECRET_KEY.length < 32) {
    console.error('🚨 [FATAL] JWT_SECRET is too short. Must be at least 32 characters.');
    process.exit(1);
}

/**
 * Verifies JWT token from Authorization header.
 * Checks token validity, expiry, and user existence in database.
 */
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`⚠️ [AUTH-BYPASS] No token provided for ${req.method} ${req.url}. Mocking credentials in dev.`);
            const userId = req.body?.userId || req.query?.userId || req.params?.userId || '4d1a3b5c-2e9f-4b0d-8a7e-1f6b2c3d4e5f';
            req.user = { userId, role: 'USER' };
            return next();
        }
        return res.status(401).json({ 
            success: false, 
            error: 'ACCESS_DENIED', 
            message: 'Authentication required. No token provided.' 
        });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        
        // Verify user/worker still exists in database
        if (decoded.userId) {
            const userRes = await db.query("SELECT id, status FROM users WHERE id = $1", [decoded.userId]);
            if (userRes.rowCount === 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🔧 [AUTH-DEV] User ${decoded.userId} not found. Auto-creating dummy user.`);
                    await db.query(
                        "INSERT INTO users (id, full_name, phone_number, status) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
                        [decoded.userId, "Dev User", "9999999999", "ACTIVE"]
                    );
                } else {
                    return res.status(401).json({ success: false, error: 'USER_NOT_FOUND', message: 'User no longer exists.' });
                }
            } else if (userRes.rows[0].status === 'BANNED') {
                return res.status(403).json({ success: false, error: 'ACCOUNT_BANNED', message: 'Your account has been suspended.' });
            }
        }
        
        if (decoded.workerId) {
            const workerRes = await db.query("SELECT id FROM workers WHERE id = $1", [decoded.workerId]);
            if (workerRes.rowCount === 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🔧 [AUTH-DEV] Worker ${decoded.workerId} not found. Auto-creating dummy worker.`);
                    await db.query(
                        "INSERT INTO workers (id, full_name, phone_number) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                        [decoded.workerId, "Dev Worker", "8888888888"]
                    );
                } else {
                    return res.status(401).json({ success: false, error: 'WORKER_NOT_FOUND', message: 'Worker no longer exists.' });
                }
            }
        }

        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, error: 'TOKEN_EXPIRED', message: 'Token has expired. Please log in again.' });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(403).json({ success: false, error: 'INVALID_TOKEN', message: 'Invalid token.' });
        }
        return res.status(403).json({ success: false, error: 'AUTH_FAILED', message: 'Authentication failed.' });
    }
};

/**
 * Optional auth — extracts user info if token present, but doesn't block.
 * Used for public routes that optionally personalize for logged-in users.
 */
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            req.user = decoded;
        } catch (err) {
            // Silently ignore invalid tokens for optional auth
            req.user = null;
        }
    } else {
        req.user = null;
    }
    next();
};

module.exports = { authenticateToken, optionalAuth, SECRET_KEY };
