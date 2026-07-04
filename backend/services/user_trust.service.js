const db = require('../config/db');
const metrics = require('../middleware/metrics');

const TRUST_EVENTS = {
    FAKE_BOOKING: { field: 'fake_bookings', weight: 15, maxPenalty: 30 },
    CANCELLATION: { field: 'cancellations', weight: 5, maxPenalty: 20 },
    DISPUTE: { field: 'disputes_initiated', weight: 8, maxPenalty: 20 },
    PAYMENT_FAILURE: { field: 'payment_failures', weight: 12, maxPenalty: 25 },
    PAYMENT_ABUSE: { field: 'payment_abuses', weight: 12, maxPenalty: 25 },
    REFUND_ABUSE: { field: 'refund_abuses', weight: 15, maxPenalty: 25 },
    NO_SHOW: { field: 'no_shows', weight: 10, maxPenalty: 20 },
    HARASSMENT_REPORT: { field: 'harassment_reports', weight: 12, maxPenalty: 15 },
    ABUSE_REPORT: { field: 'abuse_reports', weight: 8, maxPenalty: 15 },
    FRAUD_REPORT: { field: 'fraud_reports', weight: 15, maxPenalty: 30 },
    FRAUD_FLAG: { field: 'fraud_flags', weight: 20, maxPenalty: 30 },
    JOB_POSTED: { field: 'total_jobs_posted', weight: -0.5, maxBonus: 10 },
    JOB_COMPLETED: { field: 'jobs_completed', weight: -0.3, maxBonus: 10 },
    DISPUTE_WON: { field: 'disputes_won', weight: -2, maxBonus: 10 },
};

const TRUST_LEVELS = {
    TRUSTED: { min: 90, max: 100, label: 'Trusted', color: 'green' },
    NORMAL: { min: 70, max: 89, label: 'Normal', color: 'blue' },
    WATCHLIST: { min: 50, max: 69, label: 'Watchlist', color: 'yellow' },
    RESTRICTED: { min: 30, max: 49, label: 'Restricted', color: 'orange' },
    HIGH_RISK: { min: 0, max: 29, label: 'High Risk', color: 'red' },
};

class UserTrustService {
    async getOrCreateScore(userId) {
        const res = await db.query(
            "SELECT * FROM user_trust_scores WHERE user_id = $1",
            [userId]
        );
        if (res.rowCount > 0) return this._enrichScore(res.rows[0]);
        await db.query(
            "INSERT INTO user_trust_scores (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
            [userId]
        );
        return this._enrichScore({ user_id: userId, trust_score: 50 });
    }

    _enrichScore(score) {
        let level = 'HIGH_RISK';
        for (const [key, config] of Object.entries(TRUST_LEVELS)) {
            if (score.trust_score >= config.min && score.trust_score <= config.max) {
                level = key;
                break;
            }
        }
        return {
            ...score,
            trust_level: level,
            trust_level_label: TRUST_LEVELS[level].label,
            trust_level_color: TRUST_LEVELS[level].color,
        };
    }

    async recordEvent(userId, eventType, metadata = {}) {
        const event = TRUST_EVENTS[eventType];
        if (!event) return;
        const field = event.field;
        await db.query(
            `INSERT INTO user_trust_scores (user_id, ${field}) VALUES ($1, 1)
             ON CONFLICT (user_id) DO UPDATE SET ${field} = user_trust_scores.${field} + 1`,
            [userId]
        );
        await this._recalculateScore(userId);
        metrics.userTrustEventsTotal.inc({ event_type: eventType });
    }

    async _recalculateScore(userId) {
        const res = await db.query("SELECT * FROM user_trust_scores WHERE user_id = $1", [userId]);
        if (res.rowCount === 0) return;
        const u = res.rows[0];
        let score = 100;
        for (const [eventType, config] of Object.entries(TRUST_EVENTS)) {
            const count = parseInt(u[config.field] || 0);
            if (config.weight > 0) {
                score -= Math.min(config.maxPenalty, count * config.weight);
            } else {
                score += Math.min(config.maxBonus, count * Math.abs(config.weight));
            }
        }
        score = Math.max(0, Math.min(100, score));
        await db.query(
            "UPDATE user_trust_scores SET trust_score = $1, calculated_at = NOW() WHERE user_id = $2",
            [score, userId]
        );
        metrics.userTrustScore.set({ user_id: userId }, score);
    }

    async getTrustLevel(userId) {
        const score = await this.getOrCreateScore(userId);
        return {
            userId,
            trustScore: score.trust_score,
            trustLevel: score.trust_level,
            trustLevelLabel: score.trust_level_label,
            trustLevelColor: score.trust_level_color,
        };
    }

    async getDispatchMultiplier(userId) {
        const { trustScore } = await this.getOrCreateScore(userId);
        if (trustScore >= 90) return 1.0;
        if (trustScore >= 70) return 1.0;
        if (trustScore >= 50) return 0.7;
        if (trustScore >= 30) return 0.4;
        return 0.1;
    }

    async requiresAdvancePayment(userId) {
        const { trustScore } = await this.getOrCreateScore(userId);
        return trustScore < 50;
    }

    async getPayoutHoldDuration(userId) {
        const { trustScore } = await this.getOrCreateScore(userId);
        if (trustScore >= 90) return 0;
        if (trustScore >= 70) return 24;
        if (trustScore >= 50) return 48;
        return 72;
    }

    async getDisputeBias(userId) {
        const { trustScore } = await this.getOrCreateScore(userId);
        if (trustScore >= 90) return -0.2;
        if (trustScore >= 70) return -0.1;
        if (trustScore >= 50) return 0;
        if (trustScore >= 30) return 0.1;
        return 0.2;
    }

    async getMetrics(timeWindowHours = 24) {
        const res = await db.query(`
            SELECT
                trust_level,
                COUNT(*) as user_count,
                AVG(trust_score) as avg_score
            FROM user_trust_scores
            WHERE calculated_at > NOW() - INTERVAL '${timeWindowHours} hours'
            GROUP BY trust_level
        `);
        return res.rows;
    }

    async bulkRecalculate() {
        const res = await db.query("SELECT user_id FROM user_trust_scores");
        for (const row of res.rows) {
            await this._recalculateScore(row.user_id);
        }
        console.log(`[USER_TRUST] Bulk recalculated ${res.rowCount} users`);
    }
}

module.exports = new UserTrustService();