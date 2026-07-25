const db = require('../config/db');
const disputeConfig = require('../config/dispute.config');
const userTrustService = require('./user_trust.service');
const http = require('http');
const https = require('https');

async function callMLService(endpoint, bodyData) {
    const body = JSON.stringify(bodyData);
    let attempts = 0;
    const maxRetries = disputeConfig.mlMaxRetries;
    const timeout = disputeConfig.mlTimeoutMs;

    while (attempts < maxRetries) {
        attempts++;
        try {
            return await new Promise((resolve, reject) => {
                const urlObj = new URL(`${disputeConfig.mlServiceUrl}${endpoint}`);
                const transport = urlObj.protocol === 'https:' ? https : http;
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                    timeout,
                };
                const req = transport.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { reject(new Error("Invalid JSON response from ML Service")); }
                    });
                });
                req.on('error', (err) => reject(err));
                req.on('timeout', () => { req.destroy(); reject(new Error("ML Request Timeout")); });
                req.write(body);
                req.end();
            });
        } catch (err) {
            console.warn(`[ML-CLIENT-WARN] Attempt ${attempts} failed: ${err.message}`);
            if (attempts >= maxRetries) {
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempts)));
        }
    }
}

class DisputeService {
    /**
     * Create a dispute within a secure SQL transaction boundary
     */
    async createDispute(paymentId, jobId, initiatorId, initiatorRole, respondentId, reason, description = '', evidence = []) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const slaDeadline = new Date(Date.now() + disputeConfig.slaHours * 60 * 60 * 1000);
            
            const res = await client.query(
                `INSERT INTO disputes (payment_id, job_id, initiator_id, initiator_role, respondent_id, reason, description, evidence, sla_deadline)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [paymentId, jobId, initiatorId, initiatorRole, respondentId, reason, description, JSON.stringify(evidence), slaDeadline]
            );
            const dispute = res.rows[0];

            // Record user trust events if customer-initiated
            if (initiatorRole === 'USER') {
                await userTrustService.recordEvent(initiatorId, 'DISPUTE').catch(() => {});
            }

            await client.query('COMMIT');
            
            // Trigger ML risk model in background (non-blocking for UI transaction)
            this._evaluateDisputeRisk(dispute).catch(err => {
                console.warn("[DISPUTE-BACKGROUND-ML-WARN] Evaluation failed:", err.message);
            });

            return dispute;
        } catch (err) {
            await client.query('ROLLBACK');
            throw new Error(`[DISPUTE-TRANSACTION-FAILED] Could not record dispute: ${err.message}`);
        } finally {
            client.release();
        }
    }

    /**
     * Gathers all ML risk feature components concurrently
     */
    async _evaluateDisputeRisk(dispute) {
        try {
            // Fetch features concurrently (parallel DB lookups)
            const [
                jobRes,
                workerRepRes,
                userPayRes,
                disputeCountRes,
                userDisputeCountRes
            ] = await Promise.all([
                db.query("SELECT price, category, worker_id, user_id, payment_method, completed_at, created_at FROM jobs WHERE id = $1", [dispute.job_id]),
                db.query("SELECT trust_score, reliability_score FROM worker_reputation_scores WHERE worker_id = (SELECT worker_id FROM jobs WHERE id = $1)", [dispute.job_id]),
                db.query("SELECT score FROM payment_trust_scores WHERE subject_id = (SELECT user_id FROM jobs WHERE id = $1) AND role = 'USER'", [dispute.job_id]),
                db.query("SELECT COUNT(*)::int as count FROM disputes d JOIN jobs j ON d.job_id = j.id WHERE j.worker_id = (SELECT worker_id FROM jobs WHERE id = $1)", [dispute.job_id]),
                db.query("SELECT COUNT(*)::int as count FROM disputes d JOIN jobs j ON d.job_id = j.id WHERE j.user_id = (SELECT user_id FROM jobs WHERE id = $1)", [dispute.job_id])
            ]);

            const job = jobRes.rows[0];
            if (!job) return;

            const workerRep = workerRepRes.rows[0] || {};
            const userPay = userPayRes.rows[0] || {};
            
            const features = {
                job_amount: parseFloat(job.price || 0),
                category_encoded: disputeConfig.categoryMap[job.category] || disputeConfig.categoryMap.OTHER,
                job_duration_minutes: job.completed_at ? (new Date(job.completed_at) - new Date(job.created_at)) / 60000 : disputeConfig.defaultJobDurationMinutes,
                worker_trust_score: parseFloat(workerRep.trust_score || 50),
                worker_reliability_score: parseFloat(workerRep.reliability_score || 50),
                worker_fraud_probability: 0.0,
                worker_dispute_history: parseInt(disputeCountRes.rows[0]?.count || 0),
                user_payment_trust_score: parseFloat(userPay.score || 50),
                user_dispute_history: parseInt(userDisputeCountRes.rows[0]?.count || 0),
                user_tenure_days: disputeConfig.defaultUserTenureDays,
                payment_type_encoded: job.payment_method === 'CASH' ? 1 : 0,
                is_high_value: parseFloat(job.price || 0) > disputeConfig.highValueThreshold ? 1 : 0,
                hour_of_day: new Date().getHours(),
                day_of_week: new Date().getDay(),
            };

            const response = await callMLService('/predict/dispute-risk', { features });

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

    /**
     * Resolve a dispute with resolver tracking
     */
    async resolveDispute(disputeId, resolvedBy, resolution, outcome) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const res = await client.query(
                `UPDATE disputes
                 SET status = 'RESOLVED', resolution = $1, resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
                 WHERE id = $3 AND status = 'OPEN'
                 RETURNING *`,
                [resolution, resolvedBy, disputeId]
            );
            if (res.rowCount === 0) {
                throw new Error("Dispute not found or already resolved");
            }

            // Write action log
            await client.query(`
                INSERT INTO event_logs (event_type, metadata)
                VALUES ($1, $2)
            `, [
                'dispute_resolved',
                JSON.stringify({ disputeId, resolvedBy, resolution, outcome, timestamp: new Date().toISOString() })
            ]);

            await client.query('COMMIT');
            return res.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async getDispute(disputeId) {
        const res = await db.query(`SELECT id, payment_id, job_id, initiator_id, initiator_role, respondent_id, status, reason, description, sla_deadline, sla_breached FROM disputes WHERE id = $1`, [disputeId]);
        return res.rows[0] || null;
    }

    async getDisputesByPayment(paymentId) {
        const res = await db.query(
            `SELECT id, payment_id, job_id, initiator_id, initiator_role, respondent_id, status, reason, description, sla_deadline, sla_breached FROM disputes WHERE payment_id = $1 ORDER BY created_at DESC`,
            [paymentId]
        );
        return res.rows;
    }

    async getDisputesByRole(subjectId, role) {
        const column = role === 'WORKER' ? 'initiator_id' : 'respondent_id';
        const res = await db.query(
            `SELECT id, payment_id, job_id, initiator_id, initiator_role, respondent_id, status, reason, description, sla_deadline, sla_breached FROM disputes WHERE ${column} = $1 ORDER BY created_at DESC`,
            [subjectId]
        );
        return res.rows;
    }

    async getOpenDisputes() {
        const res = await db.query(
            `SELECT id, payment_id, job_id, initiator_id, initiator_role, respondent_id, status, reason, description, sla_deadline, sla_breached FROM disputes WHERE status = 'OPEN' ORDER BY sla_deadline ASC`
        );
        return res.rows;
    }

    /**
     * Evaluates SLA breach without performing dangerous runtime DDL table alters
     */
    async checkSlaBreaches() {
        try {
            const res = await db.query(
                `UPDATE disputes
                 SET sla_breached = TRUE, status = 'ESCALATED', updated_at = NOW()
                 WHERE status = 'OPEN' AND sla_deadline < NOW()
                 RETURNING *`
            );
            return res.rows;
        } catch (e) {
            console.error("⚠️ [DISPUTE] SLA breach check failed:", e.message);
            return [];
        }
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
