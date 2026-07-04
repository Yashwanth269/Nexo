const db = require('../config/db');

class PaymentTrustService {
    async getOrCreateScore(subjectId, role) {
        const res = await db.query(
            `SELECT * FROM payment_trust_scores WHERE subject_id = $1 AND role = $2`,
            [subjectId, role]
        );
        if (res.rowCount > 0) return res.rows[0];
        const insertRes = await db.query(
            `INSERT INTO payment_trust_scores (subject_id, role) VALUES ($1, $2)
             ON CONFLICT (subject_id, role) DO NOTHING
             RETURNING *`,
            [subjectId, role]
        );
        if (insertRes.rowCount > 0) return insertRes.rows[0];
        const retryRes = await db.query(
            `SELECT * FROM payment_trust_scores WHERE subject_id = $1 AND role = $2`,
            [subjectId, role]
        );
        return retryRes.rows[0];
    }

    async recordSuccessfulPayment(subjectId, role) {
        const score = await this.getOrCreateScore(subjectId, role);
        const totalPayments = (score.total_payments || 0) + 1;
        const successfulPayments = (score.successful_payments || 0) + 1;
        const newScore = this._computeScore(totalPayments, successfulPayments, score.disputed_payments || 0, score.failed_payments || 0);
        const res = await db.query(
            `UPDATE payment_trust_scores
             SET total_payments = $1, successful_payments = $2, score = $3, last_updated = NOW()
             WHERE subject_id = $4 AND role = $5
             RETURNING *`,
            [totalPayments, successfulPayments, newScore, subjectId, role]
        );
        return res.rows[0];
    }

    async recordFailedPayment(subjectId, role) {
        const score = await this.getOrCreateScore(subjectId, role);
        const totalPayments = (score.total_payments || 0) + 1;
        const failedPayments = (score.failed_payments || 0) + 1;
        const newScore = this._computeScore(totalPayments, score.successful_payments || 0, score.disputed_payments || 0, failedPayments);
        const res = await db.query(
            `UPDATE payment_trust_scores
             SET total_payments = $1, failed_payments = $2, score = $3, last_updated = NOW()
             WHERE subject_id = $4 AND role = $5
             RETURNING *`,
            [totalPayments, failedPayments, newScore, subjectId, role]
        );
        return res.rows[0];
    }

    async recordDispute(subjectId, role, won = false) {
        const score = await this.getOrCreateScore(subjectId, role);
        const disputedPayments = (score.disputed_payments || 0) + 1;
        const disputesInitiated = (score.disputes_initiated || 0) + 1;
        const disputesWon = (score.disputes_won || 0) + (won ? 1 : 0);
        const newScore = this._computeScore(score.total_payments || 0, score.successful_payments || 0, disputedPayments, score.failed_payments || 0, disputesInitiated, disputesWon);
        const res = await db.query(
            `UPDATE payment_trust_scores
             SET disputed_payments = $1, disputes_initiated = $2, disputes_won = $3, score = $4, last_updated = NOW()
             WHERE subject_id = $5 AND role = $6
             RETURNING *`,
            [disputedPayments, disputesInitiated, disputesWon, newScore, subjectId, role]
        );
        return res.rows[0];
    }

    async recordCashConfirmation(subjectId, role) {
        const score = await this.getOrCreateScore(subjectId, role);
        const cashConfirmations = (score.cash_confirmations || 0) + 1;
        const res = await db.query(
            `UPDATE payment_trust_scores
             SET cash_confirmations = $1, last_updated = NOW()
             WHERE subject_id = $2 AND role = $3
             RETURNING *`,
            [cashConfirmations, subjectId, role]
        );
        return res.rows[0];
    }

    async getScore(subjectId, role) {
        const res = await db.query(
            `SELECT score, total_payments, successful_payments, disputed_payments, failed_payments, cash_confirmations, disputes_initiated, disputes_won
             FROM payment_trust_scores WHERE subject_id = $1 AND role = $2`,
            [subjectId, role]
        );
        if (res.rowCount === 0) return { score: 50, totalPayments: 0, successfulPayments: 0, disputedPayments: 0, failedPayments: 0, cashConfirmations: 0, disputesInitiated: 0, disputesWon: 0 };
        const r = res.rows[0];
        return {
            score: r.score,
            totalPayments: r.total_payments,
            successfulPayments: r.successful_payments,
            disputedPayments: r.disputed_payments,
            failedPayments: r.failed_payments,
            cashConfirmations: r.cash_confirmations,
            disputesInitiated: r.disputes_initiated,
            disputesWon: r.disputes_won,
        };
    }

    async getAverageScore(role) {
        const res = await db.query(
            `SELECT COALESCE(AVG(score), 50) as avg_score FROM payment_trust_scores WHERE role = $1`,
            [role]
        );
        return parseFloat(res.rows[0].avg_score);
    }

    _computeScore(totalPayments, successfulPayments, disputedPayments, failedPayments, disputesInitiated = 0, disputesWon = 0) {
        if (totalPayments === 0) return 50;
        let score = 50;
        const successRatio = successfulPayments / totalPayments;
        const disputeRatio = disputedPayments / totalPayments;
        const failureRatio = failedPayments / totalPayments;
        score += successRatio * 40;
        score -= disputeRatio * 20;
        score -= failureRatio * 30;
        if (disputesInitiated > 0 && disputesInitiated === disputesWon) score += 5;
        return Math.max(0, Math.min(100, Math.round(score)));
    }
}

module.exports = new PaymentTrustService();
