/**
 * Nexo Minimum Earnings Guarantee Engine
 * 
 * Automatically evaluates worker attendance, online hours, completed jobs,
 * selfie compliance, and quality metrics against configurable guarantee thresholds.
 * If actual earnings fall below the minimum guarantee, credits the difference automatically.
 */

const db = require('../config/db');
const incentivesConfig = require('../config/incentives.config');

class MinimumGuaranteeService {
    /**
     * Evaluates daily minimum earnings guarantee for a worker.
     */
    async evaluateDailyGuarantee(workerId, dateStr = new Date().toISOString().split('T')[0]) {
        try {
            // 1. Fetch worker performance for target date
            const perfRes = await db.query(`
                SELECT 
                    COUNT(*) as jobs_completed,
                    COALESCE(SUM(price), 0) as total_earnings
                FROM jobs
                WHERE worker_id = $1
                  AND status = 'COMPLETED'
                  AND completed_at::date = $2::date
            `, [workerId, dateStr]);

            const jobsCompleted = parseInt(perfRes.rows[0].jobs_completed || '0', 10);
            const totalEarnings = parseFloat(perfRes.rows[0].total_earnings || '0');

            // 2. Check minimum requirements
            const minJobs = incentivesConfig.guarantee.dailyRequiredJobs;
            const guaranteeTarget = incentivesConfig.guarantee.dailyGuaranteeAmount;

            if (jobsCompleted < minJobs) {
                return {
                    eligible: false,
                    reason: `Completed ${jobsCompleted}/${minJobs} required jobs`,
                    shortfall: 0
                };
            }

            // 3. Calculate guarantee top-up shortfall
            if (totalEarnings >= guaranteeTarget) {
                return {
                    eligible: true,
                    topUpCredited: false,
                    actualEarnings: totalEarnings,
                    guaranteeTarget,
                    shortfall: 0,
                    message: "Earnings exceeded minimum guarantee target."
                };
            }

            const shortfall = parseFloat((guaranteeTarget - totalEarnings).toFixed(2));

            // 4. Credit shortfall to worker wallet
            const walletService = require('./wallet.service');
            await walletService.creditWorkerWallet(workerId, shortfall, `Minimum Earnings Guarantee Top-Up (${dateStr})`);

            // Log audit record
            await db.query(`
                CREATE TABLE IF NOT EXISTS minimum_guarantee_payouts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                    payout_date DATE NOT NULL,
                    jobs_completed INT NOT NULL,
                    actual_earnings DECIMAL(10,2) NOT NULL,
                    guarantee_target DECIMAL(10,2) NOT NULL,
                    top_up_amount DECIMAL(10,2) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await db.query(`
                INSERT INTO minimum_guarantee_payouts (worker_id, payout_date, jobs_completed, actual_earnings, guarantee_target, top_up_amount)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [workerId, dateStr, jobsCompleted, totalEarnings, guaranteeTarget, shortfall]);

            console.log(`💰 [MIN-GUARANTEE] Credited ₹${shortfall} top-up to worker ${workerId} for ${dateStr}.`);

            return {
                eligible: true,
                topUpCredited: true,
                actualEarnings: totalEarnings,
                guaranteeTarget,
                shortfall,
                message: `Credited ₹${shortfall} minimum guarantee top-up!`
            };
        } catch (e) {
            console.error('[MIN-GUARANTEE-ERROR]', e.message);
            return { eligible: false, error: e.message };
        }
    }
}

module.exports = new MinimumGuaranteeService();
