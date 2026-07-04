const db = require('../config/db');
const walletService = require('./wallet.service');
const metrics = require('../middleware/metrics');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

class PayoutService {
    async requestWithdrawal(workerId, amount, bankDetails, idempotencyKey = null) {
        const fraudCheck = await this._checkFraudRisk(workerId);
        console.log(`[SHADOW-FRAUD] Worker ${workerId} ML prob=${fraudCheck.fraudProbability} level=${fraudCheck.riskLevel} (logged only)`);
        await this._ruleGuardCheck(workerId);

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const balanceData = await walletService.getBalance(workerId, 'WORKER');

            if (balanceData.withdrawable < parseFloat(amount)) {
                await client.query('COMMIT');
                throw new Error(
                    `Insufficient withdrawable balance. Available: ₹${balanceData.withdrawable}, Requested: ₹${amount}. Cash-held funds must be confirmed first.`
                );
            }

            const key = idempotencyKey || crypto.randomUUID();

            const payoutRes = await client.query(
                `INSERT INTO payouts (worker_id, amount, status, bank_account, idempotency_key)
                 VALUES ($1, $2, 'PENDING', $3, $4)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING *`,
                [workerId, amount, JSON.stringify(bankDetails), key]
            );

            let payout;
            if (payoutRes.rowCount === 0) {
                const existing = await client.query(
                    `SELECT * FROM payouts WHERE idempotency_key = $1`,
                    [key]
                );
                if (existing.rowCount > 0) {
                    payout = existing.rows[0];
                }
            } else {
                payout = payoutRes.rows[0];
            }

            if (!payout) {
                throw new Error("Failed to create or find payout");
            }

            if (payout.status === 'PENDING') {
                await walletService.deductFunds(
                    workerId, 'WORKER', amount, 'WITHDRAWAL', payout.id,
                    `Withdrawal request ID: ${payout.id}`, client
                );
            }

            await client.query('COMMIT');
            return { success: true, payout, idempotent: payoutRes.rowCount === 0 };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async payoutSuccess(payoutId, utr) {
        const startTime = Date.now();
        const res = await db.query(
            `UPDATE payouts
             SET status = 'SUCCESS', utr = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [utr, payoutId]
        );
        await metrics.trackPayoutSuccess();
        metrics.payoutLatencySeconds.observe((Date.now() - startTime) / 1000);
        return res.rows[0];
    }

    async payoutFailed(payoutId, reason = "Transaction failed") {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const pRes = await client.query(`SELECT * FROM payouts WHERE id = $1`, [payoutId]);
            if (pRes.rowCount === 0) throw new Error("Payout record not found");
            const payout = pRes.rows[0];

            if (payout.status === 'FAILED') {
                await client.query('COMMIT');
                return payout;
            }

            const updatedPayoutRes = await client.query(
                `UPDATE payouts
                 SET status = 'FAILED', updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [payoutId]
            );

            await walletService.addFunds(
                payout.worker_id, 'WORKER', payout.amount, 'REFUND', payoutId,
                `Refund for failed withdrawal ID: ${payoutId}. Reason: ${reason}`, client
            );

            await metrics.trackPayoutFailed();

            await client.query('COMMIT');
            return updatedPayoutRes.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async getWorkerPayouts(workerId) {
        const res = await db.query(
            `SELECT * FROM payouts WHERE worker_id = $1 ORDER BY created_at DESC`,
            [workerId]
        );
        return res.rows;
    }

    async _checkFraudRisk(workerId) {
        try {
            const workerRes = await db.query(
                "SELECT w.*, wf.cancellation_rate, wf.fraud_risk_score, wf.reliability_score FROM workers w LEFT JOIN worker_features wf ON wf.worker_id = w.id WHERE w.id = $1",
                [workerId]
            );
            const worker = workerRes.rows[0];
            if (!worker) return { fraudProbability: 0, riskLevel: 'NORMAL' };

            const fraudScoreRes = await db.query(
                "SELECT * FROM worker_fraud_scores WHERE worker_id = $1",
                [workerId]
            );

            if (fraudScoreRes.rows.length > 0 && fraudScoreRes.rows[0].risk_level !== 'NORMAL') {
                return {
                    fraudProbability: parseFloat(fraudScoreRes.rows[0].fraud_probability),
                    riskLevel: fraudScoreRes.rows[0].risk_level,
                    actions: fraudScoreRes.rows[0].actions || [],
                };
            }

            const disputeCountRes = await db.query(
                "SELECT COUNT(*) as count FROM disputes d JOIN jobs j ON d.job_id = j.id WHERE j.worker_id = $1",
                [workerId]
            );
            const gpsRes = await db.query(
                "SELECT gps_trust_score FROM worker_gps_risk WHERE worker_id = $1",
                [workerId]
            );

            const features = {
                completion_time_minutes: 30,
                travel_time_minutes: 15,
                stay_duration_minutes: 30,
                disputes_count: parseInt(disputeCountRes.rows[0]?.count || 0),
                complaints_count: 0,
                fraud_history: parseFloat(worker.fraud_risk_score || 0),
                gps_trust_score: parseFloat(gpsRes.rows[0]?.gps_trust_score || 100),
                jobs_per_day: 2,
                cancellation_rate: parseFloat(worker.cancellation_rate || 0),
                reassignment_rate: 0,
                cash_disputes: 0,
                payout_anomalies: 0,
                reputation_score: parseFloat(worker.reliability_score || 1) * 100,
            };

            const body = JSON.stringify({ features });
            const response = await new Promise((resolve, reject) => {
                const urlObj = new URL(`${ML_SERVICE_URL}/predict/fraud`);
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
                    INSERT INTO worker_fraud_scores (worker_id, fraud_probability, risk_level, actions, calculated_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (worker_id) DO UPDATE SET
                        fraud_probability = EXCLUDED.fraud_probability,
                        risk_level = EXCLUDED.risk_level,
                        actions = EXCLUDED.actions,
                        calculated_at = NOW()
                `, [workerId, response.fraud_probability || 0, response.risk_level || 'NORMAL', JSON.stringify(response.actions || [])]);

                return {
                    fraudProbability: response.fraud_probability || 0,
                    riskLevel: response.risk_level || 'NORMAL',
                    actions: response.actions || [],
                };
            }
            return { fraudProbability: 0, riskLevel: 'NORMAL' };
        } catch (e) {
            console.warn('[PAYOUT-FRAUD-CHECK] Failed:', e.message);
            return { fraudProbability: 0, riskLevel: 'NORMAL' };
        }
    }
}

async function _ruleGuardCheck(workerId) {
    try {
        const res = await db.query(`
            SELECT
                COALESCE(wf.cancellation_rate, 0) as cancellation_rate,
                (SELECT COUNT(*) FROM disputes d JOIN jobs j ON d.job_id = j.id WHERE j.worker_id = w.id) as dispute_count
            FROM workers w
            LEFT JOIN worker_features wf ON wf.worker_id = w.id
            WHERE w.id = $1
        `, [workerId]);
        if (res.rowCount === 0) return;
        const { cancellation_rate, dispute_count } = res.rows[0];
        if (parseFloat(cancellation_rate) > 50 && parseInt(dispute_count) >= 3) {
            throw new Error(`Withdrawal blocked: High cancellation rate (${cancellation_rate}%) and dispute history (${dispute_count} disputes)`);
        }
        if (parseFloat(cancellation_rate) > 70) {
            throw new Error(`Withdrawal blocked: Cancellation rate (${cancellation_rate}%) exceeds threshold`);
        }
    } catch (e) {
        if (e.message.startsWith('Withdrawal blocked')) throw e;
        console.warn('[RULE-GUARD] Check failed:', e.message);
    }
}

module.exports = new PayoutService();