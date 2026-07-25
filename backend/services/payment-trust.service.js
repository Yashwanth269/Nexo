const db = require('../config/db');

class PaymentTrustService {
    async getOrCreateScore(subjectId, role) {
        const res = await db.query(
            `SELECT * FROM payment_trust_scores WHERE subject_id = $1 AND role = $2`,
            [subjectId, role]
        );
        if (res.rowCount > 0) return res.rows[0];
        
        const insertRes = await db.query(
            `INSERT INTO payment_trust_scores (subject_id, role, score, total_payments, successful_payments, failed_payments, disputed_payments) 
             VALUES ($1, $2, 85, 0, 0, 0, 0)
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
        
        const newScore = await this._computeAdaptiveScore(subjectId, role, totalPayments, successfulPayments, score.disputed_payments || 0, score.failed_payments || 0);
        
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
        
        const newScore = await this._computeAdaptiveScore(subjectId, role, totalPayments, score.successful_payments || 0, score.disputed_payments || 0, failedPayments);
        
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
        
        const newScore = await this._computeAdaptiveScore(subjectId, role, score.total_payments || 0, score.successful_payments || 0, disputedPayments, score.failed_payments || 0, disputesInitiated, disputesWon);
        
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
        
        const defaultScore = { score: 85, totalPayments: 0, successfulPayments: 0, disputedPayments: 0, failedPayments: 0, cashConfirmations: 0, disputesInitiated: 0, disputesWon: 0 };
        if (res.rowCount === 0) {
            return {
                ...defaultScore,
                explainability: {
                    baseScore: 85,
                    reason: "New account base smoothing average applied."
                }
            };
        }
        
        const r = res.rows[0];
        
        // Explainability breakdown (Point 5)
        const explainability = {
            baseScore: 85,
            deductions: {
                failures: (r.failed_payments || 0) * 15,
                disputes: (r.disputed_payments || 0) * 20
            },
            boosts: {
                cashConfirmations: Math.min(10, (r.cash_confirmations || 0) * 2)
            },
            reason: `Trust score of ${r.score} computed using Bayesian smoothing over ${r.total_payments} transactions.`
        };

        return {
            score: r.score,
            totalPayments: r.total_payments,
            successfulPayments: r.successful_payments,
            disputedPayments: r.disputed_payments,
            failedPayments: r.failed_payments,
            cashConfirmations: r.cash_confirmations,
            disputesInitiated: r.disputes_initiated,
            disputesWon: r.disputes_won,
            explainability
        };
    }

    async getAverageScore(role) {
        const res = await db.query(
            `SELECT COALESCE(AVG(score), 85) as avg_score FROM payment_trust_scores WHERE role = $1`,
            [role]
        );
        return parseFloat(res.rows[0].avg_score);
    }

    /**
     * Computes trust score using Bayesian Smoothing and Time Decay (Points 1 & 2)
     */
    async _computeAdaptiveScore(subjectId, role, totalPayments, successfulPayments, disputedPayments, failedPayments, disputesInitiated = 0, disputesWon = 0) {
        // Query recent 180 days payments to calculate decay factor
        const recentRes = await db.query(`
            SELECT payment_status, created_at
            FROM payments
            WHERE (payer_id = $1 OR worker_id = $1)
              AND created_at >= NOW() - INTERVAL '180 days'
        `, [subjectId]);

        let sumWeights = 0;
        let sumValue = 0;

        recentRes.rows.forEach(p => {
            const ageDays = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 3600 * 24);
            // Exponential time decay: newer events weigh more (half-life of 60 days)
            const weight = Math.exp(-ageDays * 0.0115); // age decay parameter
            const val = p.payment_status === 'SUCCESS' ? 1.0 : (p.payment_status === 'FAILED' ? 0.0 : 0.5);
            
            sumWeights += weight;
            sumValue += val * weight;
        });

        // 2. Bayesian Smoothing: Smooth small sample pools towards global mean of 85
        const C = 5; // confidence parameter
        const globalMean = 85.0;
        
        let rawScore = 85;
        if (sumWeights > 0) {
            const decayRatio = sumValue / sumWeights;
            rawScore = (decayRatio * 100);
        } else {
            // Heuristic calculation if no payments found in last 180 days
            const successRatio = totalPayments > 0 ? (successfulPayments / totalPayments) : 1.0;
            rawScore = successRatio * 100;
        }

        // Apply Bayesian average formula: (C * globalMean + total * rawScore) / (C + total)
        const smoothedScore = (C * globalMean + totalPayments * rawScore) / (C + totalPayments);

        // Deduct for disputes and failures
        let finalScore = smoothedScore;
        if (disputedPayments > 0) finalScore -= (disputedPayments * 5);
        if (failedPayments > 0) finalScore -= (failedPayments * 10);

        return Math.max(0, Math.min(100, Math.round(finalScore)));
    }
}

module.exports = new PaymentTrustService();
