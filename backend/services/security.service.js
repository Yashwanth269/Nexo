const crypto = require('crypto');
const geoip = require('geoip-lite');
const db = require('../config/db');

class SecurityService {
    generateFingerprint(ip, deviceId, userAgent) {
        return crypto.createHash('sha256')
            .update(`${ip}-${deviceId}-${userAgent}`)
            .digest('hex');
    }

    async calculateRiskScore(userId, currentIp, currentDeviceId, currentFingerprint) {
        try {
            const profileRes = await db.query(
                "SELECT * FROM user_security_profiles WHERE user_id = $1",
                [userId]
            );

            if (profileRes.rowCount === 0) return 0.1;

            const profile = profileRes.rows[0];
            let risk = 0.0;

            if (profile.last_ip !== currentIp) risk += 0.2;
            if (profile.last_device !== currentDeviceId) risk += 0.3;
            if (profile.fingerprint !== currentFingerprint) risk += 0.2;

            const sameIpRes = await db.query(
                "SELECT COUNT(DISTINCT user_id) as account_count FROM login_sessions WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '1 hour'",
                [currentIp]
            );
            if (parseInt(sameIpRes.rows[0].account_count) > 2) risk += 0.4;

            return Math.min(risk, 1.0);
        } catch (error) {
            console.error("Risk Calculation Error:", error);
            return 0.5;
        }
    }

    async detectAnomaly(userId, currentLat, currentLng, currentIp) {
        try {
            const userRes = await db.query("SELECT last_login_gps FROM users WHERE id = $1", [userId]);
            if (userRes.rowCount === 0 || !userRes.rows[0].last_login_gps) return false;

            const lastGps = userRes.rows[0].last_login_gps;
            const distance = this.calculateDistance(lastGps.lat, lastGps.lng, currentLat, currentLng);

            if (distance > 200) {
                return { type: 'SUSPICIOUS_DISTANCE', distance };
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    async detectLoginVelocity(userId, currentIp, currentLat, currentLng) {
        try {
            const recentLogins = await db.query(
                `SELECT ip_address, created_at FROM login_sessions
                 WHERE user_id = $1 AND created_at > NOW() - INTERVAL '15 minutes'
                 ORDER BY created_at DESC`,
                [userId]
            );
            if (recentLogins.rowCount < 2) return null;

            const lastLogin = recentLogins.rows[0];
            if (lastLogin.ip_address !== currentIp) {
                const geo1 = geoip.lookup(lastLogin.ip_address);
                const geo2 = geoip.lookup(currentIp);
                if (geo1 && geo2 && geo1.country !== geo2.country) {
                    return { type: 'CROSS_COUNTRY_VELOCITY', from: geo1.country, to: geo2.country };
                }
            }

            if (currentLat && currentLng && recentLogins.rows.length > 1) {
                const prevRes = await db.query(
                    `SELECT last_login_gps FROM users WHERE id = $1`,
                    [userId]
                );
                if (prevRes.rowCount > 0 && prevRes.rows[0].last_login_gps) {
                    const prevGps = prevRes.rows[0].last_login_gps;
                    if (prevGps.lat && prevGps.lng) {
                        const dist = this.calculateDistance(parseFloat(prevGps.lat), parseFloat(prevGps.lng), currentLat, currentLng);
                        if (dist > 500) {
                            return { type: 'GEO_VELOCITY_500KM', distance: Math.round(dist) };
                        }
                    }
                }
            }

            return null;
        } catch (_) {
            return null;
        }
    }

    async bindDevice(userId, role, deviceId, fingerprint) {
        await db.query(
            `INSERT INTO user_devices (user_id, role, device_id, fingerprint, trusted)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (user_id, device_id) DO UPDATE SET
             fingerprint = EXCLUDED.fingerprint, last_seen = NOW()`,
            [userId, role, deviceId, fingerprint]
        );
    }

    async isDeviceTrusted(userId, deviceId) {
        const res = await db.query(
            `SELECT trusted FROM user_devices WHERE user_id = $1 AND device_id = $2`,
            [userId, deviceId]
        );
        return res.rowCount > 0 && res.rows[0].trusted;
    }

    async invalidateSession(userId, sessionId) {
        await db.query(`UPDATE login_sessions SET revoked = true WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
    }

    async invalidateAllSessions(userId, excludeSessionId = null) {
        if (excludeSessionId) {
            await db.query(
                `UPDATE login_sessions SET revoked = true WHERE user_id = $1 AND id != $2`,
                [userId, excludeSessionId]
            );
        } else {
            await db.query(`UPDATE login_sessions SET revoked = true WHERE user_id = $1`, [userId]);
        }
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    async logSecurityEvent(userId, eventType, ip, riskScore, details) {
        try {
            await db.query(
                "INSERT INTO security_audit_logs (user_id, event_type, ip_address, risk_score, details) VALUES ($1, $2, $3, $4, $5)",
                [userId, eventType, ip, riskScore, JSON.stringify(details)]
            );

            await db.query(
                `INSERT INTO user_security_profiles (user_id, last_ip, last_device, fingerprint, risk_score, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (user_id) DO UPDATE
                 SET last_ip = $2, last_device = $3, fingerprint = $4, risk_score = $5, updated_at = NOW()`,
                [userId, ip, details.deviceId, details.fingerprint, riskScore]
            );
        } catch (error) {
            console.error("Security Logging Error:", error);
        }
    }

    getIpLocation(ip) {
        const geo = geoip.lookup(ip);
        if (!geo) return null;
        return { city: geo.city, region: geo.region, country: geo.country };
    }
}

module.exports = new SecurityService();
