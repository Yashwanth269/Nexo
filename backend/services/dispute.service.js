const db = require('../config/db');
const http = require('http');
const https = require('https');
const userTrustService = require('./user_trust.service');

const SLA_HOURS = 48;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

class DisputeService {
    async createDispute(paymentId, jobId, initiatorId, initiatorRole, respondentId, reason, description = '', evidence = []) {
        const slaDeadline = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000);
        const res = await db.query(
            `INSERT INTO disputes (payment_id, job_id, initiator_id, initiator_role, respondent_id, reason, description, evidence, sla_deadline)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [paymentId, jobId, initiatorId, initiatorRole, respondentId, reason, description, JSON.stringify(evidence), slaDeadline]
        );

        const dispute = res.rows[0];
        await this._evaluateDisputeRisk(dispute);
        if (initiatorRole === 'USER') {
            userTrustService.recordEvent(initiatorId, 'DISPUTE').catch(() => {});
        }
        return dispute;
    }

    async _evaluateDisputeRisk(dispute) {
        try {
            const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [dispute.job_id]);
            const job = jobRes.rows[0];
            if (!job) return;

            const workerRepRes = await db.query(
                "SELECT trust_score, reliability_score FROM worker_reputation_scores WHERE worker_id = $1",
                [job.worker_id]
            );
            const workerRep = workerRepRes.rows[0] || {};
            const userPayRes = await db.query(
                "SELECT score FROM payment_trust_scores WHERE subject_id = $1 AND role = 'USER'",
                [job.user_id]
            );
            const userPay = userPayRes.rows[0] || {};
            const disputeCountRes = await db.query(
                "SELECT COUNT(*) as count FROM disputes d JOIN jobs j ON d.job_id = j.id WHERE j.worker_id = $1",
                [job.worker_id]
            );
            const userDisputeCountRes = await db.query(
                "SELECT COUNT(*) as count FROM disputes d JOIN jobs j ON d.job_id = j.id WHERE j.user_id = $1",
                [job.user_id]
            );

            const categoryMap = {
                "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2, "PAINTING": 3,
                "CARPENTRY": 4, "MOVING": 5, "GARDENING": 6, "APPLIANCE_REPAIR": 7,
                "IT_SUPPORT": 8, "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
                "DELIVERY": 12, "OTHER": 13
            };
            const features = {
                job_amount: parseFloat(job.price || 0),
                category_encoded: categoryMap[job.category] || 13,
                job_duration_minutes: job.completed_at ? (new Date(job.completed_at) - new Date(job.created_at)) / 60000 : 30,
                worker_trust_score: parseFloat(workerRep.trust_score || 50),
                worker_reliability_score: parseFloat(workerRep.reliability_score || 50),
                worker_fraud_probability: 0.0,
                worker_dispute_history: parseInt(disputeCountRes.rows[0]?.count || 0),
                user_payment_trust_score: parseFloat(userPay.score || 50),
                user_dispute_history: parseInt(userDisputeCountRes.rows[0]?.count || 0),
                user_tenure_days: 30,
                payment_type_encoded: job.payment_method === 'CASH' ? 1 : 0,
                is_high_value: parseFloat(job.price || 0) > 1000 ? 1 : 0,
                hour_of_day: new Date().getHours(),
                day_of_week: new Date().getDay(),
            };

            const body = JSON.stringify({ features });
            const response = await new Promise((resolve, reject) => {
                const urlObj = new URL(`${ML_SERVICE_URL}/predict/dispute-risk`);
                const transport = urlObj.protocol === 'https:' ? https : http;
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                    timeout: 2000,
                };
                const req = transport.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.on('timeout', () => { req.destroy(); resolve(null); });
                req.write(body);
                req.end();
            });

            if (response) {
                await db.query(`
                    INSERT INTO job_dispute_risk (job_id, dispute_risk, risk_band, recommendation, requires_review, hold_amount, release_amount)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (job_id) DO UPDATE SET
                        dispute_risk = EXCLUDED.dispute_risk,
                        risk_band = EXCLUDED.risk_band,
                        recommendation = EXCLUDED.recommendation,
                        requires_review = EXCLUDED.requires_review,
                        calculated_at = NOW()
                `, [
                    dispute.job_id,
                    response.dispute_risk || 0,
                    response.level || 'LOW',
                    response.recommendation || 'auto_resolve',
                    false,
                    0,
                    0,
                ]);
                console.log(`[SHADOW-DISPUTE] Job=${dispute.job_id} risk=${response.dispute_risk} band=${response.level} (logged, not holding funds)`);
            }
        } catch (e) {
            console.warn('[DISPUTE-RISK] Evaluation failed:', e.message);
        }
    }

    async resolveDispute(disputeId, resolvedBy, resolution, outcome) {
        const res = await db.query(
            `UPDATE disputes
             SET status = 'RESOLVED', resolution = $1, resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
             WHERE id = $3 AND status = 'OPEN'
             RETURNING *`,
            [resolution, resolvedBy, disputeId]
        );
        if (res.rowCount === 0) throw new Error("Dispute not found or already resolved");
        return res.rows[0];
    }

    async getDispute(disputeId) {
        const res = await db.query(`SELECT * FROM disputes WHERE id = $1`, [disputeId]);
        return res.rows[0] || null;
    }

    async getDisputesByPayment(paymentId) {
        const res = await db.query(
            `SELECT * FROM disputes WHERE payment_id = $1 ORDER BY created_at DESC`,
            [paymentId]
        );
        return res.rows;
    }

    async getDisputesByRole(subjectId, role) {
        const column = role === 'WORKER' ? 'initiator_id' : 'respondent_id';
        const res = await db.query(
            `SELECT * FROM disputes WHERE ${column} = $1 ORDER BY created_at DESC`,
            [subjectId]
        );
        return res.rows;
    }

    async getOpenDisputes() {
        const res = await db.query(
            `SELECT * FROM disputes WHERE status = 'OPEN' ORDER BY sla_deadline ASC`
        );
        return res.rows;
    }

    async checkSlaBreaches() {
        const res = await db.query(
            `UPDATE disputes
             SET sla_breached = TRUE, status = 'ESCALATED', updated_at = NOW()
             WHERE status = 'OPEN' AND sla_deadline < NOW()
             RETURNING *`
        );
        return res.rows;
    }

    async getSlaStatus(disputeId) {
        const dispute = await this.getDispute(disputeId);
        if (!dispute) return null;
        const now = new Date();
        const deadline = new Date(dispute.sla_deadline);
        const remaining = Math.max(0, deadline - now);
        return {
            disputeId: dispute.id,
            status: dispute.status,
            slaDeadline: dispute.sla_deadline,
            slaBreached: dispute.sla_breached,
            remainingMs: remaining,
            remainingHours: Math.round(remaining / (1000 * 60 * 60) * 10) / 10,
        };
    }
}

module.exports = new DisputeService();
