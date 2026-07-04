const jwt = require('jsonwebtoken');
const db = require('../config/db');
const crypto = require('crypto');

const REFRESH_TOKEN_EXPIRY = '30d';
const ACCESS_TOKEN_EXPIRY = '15m';
const SECRET_KEY = process.env.JWT_SECRET;

function generateAccessToken(payload) {
    return jwt.sign(payload, SECRET_KEY, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken() {
    return crypto.randomBytes(48).toString('hex');
}

async function storeRefreshToken(userId, role, refreshToken) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // Invalidate old refresh tokens for this user (rotation)
    await db.query(
        `UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND role = $2 AND revoked = false`,
        [userId, role]
    );
    await db.query(
        `INSERT INTO refresh_tokens (user_id, role, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, role, crypto.createHash('sha256').update(refreshToken).digest('hex'), expiresAt]
    );
}

async function validateRefreshToken(userId, role, refreshToken) {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const res = await db.query(
        `SELECT id FROM refresh_tokens
         WHERE user_id = $1 AND role = $2 AND token_hash = $3
           AND revoked = false AND expires_at > NOW()`,
        [userId, role, hash]
    );
    if (res.rowCount === 0) return null;
    // Revoke used token (rotation)
    await db.query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [res.rows[0].id]);
    return true;
}

async function revokeAllUserTokens(userId) {
    await db.query(
        `UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false`,
        [userId]
    );
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    storeRefreshToken,
    validateRefreshToken,
    revokeAllUserTokens,
};
