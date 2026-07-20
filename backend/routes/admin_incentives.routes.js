/**
 * Nexo Admin Incentives, Revenue & Selfie Analytics Routes
 * 
 * Exposes real-time dashboards for incentive payouts, minimum guarantee costs,
 * cancellation fee splits, and selfie verification compliance.
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const incentivesConfig = require('../config/incentives.config');

/**
 * GET /api/admin/incentives/overview
 */
router.get('/overview', async (req, res) => {
    try {
        const timeframeDays = parseInt(req.query.days || '30', 10);

        // 1. Minimum Guarantee Top-Up Totals
        const guaranteeRes = await db.query(`
            SELECT 
                COUNT(*) as total_payout_events,
                COALESCE(SUM(top_up_amount), 0) as total_top_up_amount
            FROM minimum_guarantee_payouts
            WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
        `, [timeframeDays]);

        // 2. Selfie Verification Statistics
        const selfieRes = await db.query(`
            SELECT 
                COUNT(*) as total_verifications,
                COUNT(CASE WHEN status = 'VERIFIED' THEN 1 END) as total_verified,
                COUNT(CASE WHEN status LIKE 'FAILED%' THEN 1 END) as total_failed,
                AVG(confidence_score) as avg_confidence_score
            FROM worker_selfie_verifications
            WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
        `, [timeframeDays]);

        const selfieStats = selfieRes.rows[0];
        const totalSelfies = parseInt(selfieStats.total_verifications || '0', 10);
        const verifiedSelfies = parseInt(selfieStats.total_verified || '0', 10);
        const successRatePct = totalSelfies > 0 ? ((verifiedSelfies / totalSelfies) * 100).toFixed(1) : '100.0';

        res.json({
            success: true,
            timeframeDays,
            minimumGuarantee: {
                totalEvents: parseInt(guaranteeRes.rows[0].total_payout_events || '0', 10),
                totalTopUpAmount: parseFloat(guaranteeRes.rows[0].total_top_up_amount || '0')
            },
            selfieVerification: {
                totalVerifications: totalSelfies,
                verifiedCount: verifiedSelfies,
                failedCount: parseInt(selfieStats.total_failed || '0', 10),
                successRatePct: parseFloat(successRatePct),
                avgConfidenceScore: parseFloat(parseFloat(selfieStats.avg_confidence_score || '95.0').toFixed(1))
            },
            config: incentivesConfig
        });
    } catch (e) {
        console.error('[ADMIN-INCENTIVES-ERROR]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
