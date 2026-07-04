const db = require("../config/db");

const TRUST_WEIGHT = 0.35;
const RELIABILITY_WEIGHT = 0.30;
const QUALITY_WEIGHT = 0.20;
const RESPONSE_WEIGHT = 0.15;

class ReputationService {
    async calculateTrustScore(workerId) {
        const client = await db.pool.connect();
        try {
            const result = await client.query(
                `SELECT 
                    COALESCE(w.rating, 4.0) as rating,
                    COALESCE(pts.disputed_payments, 0) as disputed_payments,
                    COALESCE(pts.successful_payments, 0) as successful_payments,
                    COALESCE(pts.failed_payments, 0) as failed_payments,
                    COALESCE(pts.cash_confirmations, 0) as cash_confirmations,
                    COALESCE(pts.disputes_initiated, 0) as disputes_initiated,
                    COALESCE(pts.disputes_won, 0) as disputes_won,
                    COALESCE(pts.score, 50) as payment_trust_score
                 FROM workers w
                 LEFT JOIN payment_trust_scores pts ON pts.subject_id = w.id AND pts.role = 'WORKER'
                 WHERE w.id = $1`,
                [workerId]
            );

            if (result.rowCount === 0) return 50;

            const r = result.rows[0];
            const totalPayments = r.successful_payments + r.failed_payments + r.disputed_payments;
            
            let score = 50;
            
            const disputeRate = totalPayments > 0 ? r.disputed_payments / totalPayments : 0;
            score -= disputeRate * 30;
            
            const failureRate = totalPayments > 0 ? r.failed_payments / totalPayments : 0;
            score -= failureRate * 25;
            
            if (r.disputes_initiated > 0) {
                const winRate = r.disputes_won / r.disputes_initiated;
                score += (winRate - 0.5) * 20;
            }
            
            score += (r.cash_confirmations || 0) * 2;
            
            score = Math.max(0, Math.min(100, score + (r.payment_trust_score - 50) * 0.5));
            
            return Math.round(score * 100) / 100;
        } finally {
            client.release();
        }
    }

    async calculateReliabilityScore(workerId) {
        const client = await db.pool.connect();
        try {
            const result = await client.query(
                `SELECT 
                    w.jobs_completed,
                    COALESCE(wf.completion_rate, 100) as completion_rate,
                    COALESCE(wf.avg_response_time, 30) as avg_response_time,
                    COALESCE(pts.disputed_payments, 0) as disputed_payments,
                    COALESCE(pts.successful_payments, 0) as successful_payments,
                    (SELECT COUNT(*) FROM event_logs el 
                     WHERE el.worker_id = w.id 
                     AND el.event_type IN ('JOB_REJECTED', 'JOB_TIMEOUT', 'JOB_CANCELLED')
                     AND el.created_at > NOW() - INTERVAL '30 days') as negative_events_30d,
                    (SELECT COUNT(*) FROM jobs j 
                     WHERE j.worker_id = w.id 
                     AND j.status = 'COMPLETED'
                     AND j.created_at > NOW() - INTERVAL '30 days') as completed_30d,
                    (SELECT COUNT(*) FROM job_offers jo 
                     WHERE jo.worker_id = w.id 
                     AND jo.status = 'ACCEPTED'
                     AND jo.created_at > NOW() - INTERVAL '30 days') as accepted_30d
                 FROM workers w
                 LEFT JOIN worker_features wf ON wf.worker_id = w.id
                 LEFT JOIN payment_trust_scores pts ON pts.subject_id = w.id AND pts.role = 'WORKER'
                 WHERE w.id = $1`,
                [workerId]
            );

            if (result.rowCount === 0) return 50;

            const r = result.rows[0];
            let score = 50;

            score += (r.completion_rate - 50) * 0.8;

            const totalAccepted = r.accepted_30d || 0;
            const cancellationRate = totalAccepted > 0 ? r.negative_events_30d / totalAccepted : 0;
            score -= cancellationRate * 40;

            if (r.avg_response_time > 60) score -= 10;
            else if (r.avg_response_time > 30) score -= 5;
            else if (r.avg_response_time < 15) score += 5;

            score = Math.max(0, Math.min(100, score));
            return Math.round(score * 100) / 100;
        } finally {
            client.release();
        }
    }

    async calculateQualityScore(workerId) {
        const client = await db.pool.connect();
        try {
            const result = await client.query(
                `SELECT 
                    COALESCE(w.rating, 4.0) as rating,
                    (SELECT COUNT(*) FROM completed_job_posts cjp 
                     WHERE cjp.worker_id = w.id 
                     AND cjp.created_at > NOW() - INTERVAL '90 days') as recent_posts,
                    (SELECT AVG(COALESCE(cjp.worker_rating, 4.5)) 
                     FROM completed_job_posts cjp 
                     WHERE cjp.worker_id = w.id 
                     AND cjp.created_at > NOW() - INTERVAL '90 days') as avg_review_rating,
                    (SELECT COUNT(DISTINCT cjp.user_id) 
                     FROM completed_job_posts cjp 
                     WHERE cjp.worker_id = w.id 
                     AND cjp.created_at > NOW() - INTERVAL '90 days') as repeat_users,
                    (SELECT COUNT(*) FROM disputes d 
                     WHERE d.initiator_id = w.id 
                     AND d.initiator_role = 'WORKER'
                     AND d.created_at > NOW() - INTERVAL '90 days') as worker_disputes_90d
                 FROM workers w
                 WHERE w.id = $1`,
                [workerId]
            );

            if (result.rowCount === 0) return 50;

            const r = result.rows[0];
            let score = 50;

            score += (r.rating - 4.0) * 20;

            if (r.avg_review_rating) {
                score += (r.avg_review_rating - 4.0) * 15;
            }

            if (r.repeat_users && r.recent_posts > 0) {
                const repeatRate = r.repeat_users / r.recent_posts;
                score += repeatRate * 15;
            }

            score -= (r.worker_disputes_90d || 0) * 5;

            score = Math.max(0, Math.min(100, score));
            return Math.round(score * 100) / 100;
        } finally {
            client.release();
        }
    }

    async calculateResponseScore(workerId) {
        const client = await db.pool.connect();
        try {
            const result = await client.query(
                `SELECT 
                    COALESCE(wf.avg_response_time, 30) as avg_response_time,
                    COALESCE(wf.acceptance_rate, 50) as acceptance_rate,
                    (SELECT COUNT(*) FROM job_offers jo 
                     WHERE jo.worker_id = w.id 
                     AND jo.status = 'ACCEPTED'
                     AND jo.created_at > NOW() - INTERVAL '30 days') as accepted_30d,
                    (SELECT COUNT(*) FROM job_offers jo 
                     WHERE jo.worker_id = w.id 
                     AND jo.created_at > NOW() - INTERVAL '30 days') as offered_30d,
                    (SELECT COUNT(*) FROM job_offers jo 
                     WHERE jo.worker_id = w.id 
                     AND jo.status IN ('IGNORED', 'TIMEOUT')
                     AND jo.created_at > NOW() - INTERVAL '30 days') as ignored_30d
                 FROM workers w
                 LEFT JOIN worker_features wf ON wf.worker_id = w.id
                 WHERE w.id = $1`,
                [workerId]
            );

            if (result.rowCount === 0) return 50;

            const r = result.rows[0];
            let score = 50;

            score += (r.acceptance_rate - 50) * 0.6;

            const totalOffered = r.offered_30d || 0;
            const ignoredRate = totalOffered > 0 ? (r.ignored_30d || 0) / totalOffered : 0;
            score -= ignoredRate * 30;

            if (r.avg_response_time > 120) score -= 15;
            else if (r.avg_response_time > 60) score -= 5;
            else if (r.avg_response_time < 15) score += 10;

            score = Math.max(0, Math.min(100, score));
            return Math.round(score * 100) / 100;
        } finally {
            client.release();
        }
    }

    async recalculateWorkerReputation(workerId) {
        const [trustScore, reliabilityScore, qualityScore, responseScore] = await Promise.all([
            this.calculateTrustScore(workerId),
            this.calculateReliabilityScore(workerId),
            this.calculateQualityScore(workerId),
            this.calculateResponseScore(workerId)
        ]);

        const overallScore = Math.round(
            (trustScore * TRUST_WEIGHT +
             reliabilityScore * RELIABILITY_WEIGHT +
             qualityScore * QUALITY_WEIGHT +
             responseScore * RESPONSE_WEIGHT) * 100
        ) / 100;

        const client = await db.pool.connect();
        try {
            await client.query(
                `INSERT INTO worker_reputation_scores (worker_id, trust_score, reliability_score, quality_score, response_score, overall_score, calculated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (worker_id) DO UPDATE SET
                     trust_score = $2,
                     reliability_score = $3,
                     quality_score = $4,
                     response_score = $5,
                     overall_score = $6,
                     calculated_at = NOW()`,
                [workerId, trustScore, reliabilityScore, qualityScore, responseScore, overallScore]
            );
        } finally {
            client.release();
        }

        return { trustScore, reliabilityScore, qualityScore, responseScore, overallScore };
    }

    async getReputation(workerId) {
        const client = await db.pool.connect();
        try {
            const result = await client.query(
                `SELECT * FROM worker_reputation_scores WHERE worker_id = $1`,
                [workerId]
            );
            if (result.rowCount === 0) {
                return await this.recalculateWorkerReputation(workerId);
            }
            return result.rows[0];
        } finally {
            client.release();
        }
    }

    async getTopWorkersByReputation(limit = 20, minJobs = 5) {
        const result = await db.query(
            `SELECT w.id, w.full_name, w.rating, w.jobs_completed,
                    wrs.trust_score, wrs.reliability_score, wrs.quality_score, wrs.response_score, wrs.overall_score
             FROM workers w
             JOIN worker_reputation_scores wrs ON wrs.worker_id = w.id
             WHERE w.jobs_completed >= $1
             ORDER BY wrs.overall_score DESC, w.rating DESC
             LIMIT $2`,
            [minJobs, limit]
        );
        return result.rows;
    }

    async getWorkersWithLowReputation(threshold = 30) {
        const result = await db.query(
            `SELECT w.id, w.full_name, w.phone_number, w.rating, w.jobs_completed,
                    wrs.trust_score, wrs.reliability_score, wrs.quality_score, wrs.response_score, wrs.overall_score
             FROM workers w
             JOIN worker_reputation_scores wrs ON wrs.worker_id = w.id
             WHERE wrs.overall_score < $1
             ORDER BY wrs.overall_score ASC
             LIMIT 50`,
            [threshold]
        );
        return result.rows;
    }
}

module.exports = new ReputationService();