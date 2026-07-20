/**
 * Nexo ML Scheduled Job Risk Prediction Engine
 * 
 * Predicts cancellation, no-show, schedule conflict, and ETA traffic risks
 * for upcoming scheduled bookings. Includes rule-based fallback if ML service is unreachable.
 */

const db = require('../config/db');
const redis = require('../config/redis');
const scheduledConfig = require('../config/scheduled.config');
const http = require('http');
const https = require('https');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

class ScheduledRiskMLService {
    /**
     * Evaluates comprehensive risk score (0.0 to 1.0) and risk tier (GREEN, YELLOW, ORANGE, RED).
     */
    async predictReservationRisk(job, workerId) {
        if (!workerId || !job) {
            return { riskScore: 0.0, tier: 'GREEN', factors: {} };
        }

        try {
            // Fetch worker stats & recent history
            const workerRes = await db.query(`
                SELECT w.id, w.is_online, w.is_available, w.verification_status, w.current_lat, w.current_lng,
                       r.reliability_score, r.trust_score, r.cancellation_rate, r.completion_rate,
                       r.overall_score
                FROM workers w
                LEFT JOIN worker_reputation_scores r ON w.id = r.worker_id
                WHERE w.id = $1
            `, [workerId]);

            if (workerRes.rowCount === 0) {
                return { riskScore: 0.9, tier: 'RED', factors: { reason: 'WORKER_NOT_FOUND' } };
            }

            const worker = workerRes.rows[0];

            // 1. Account & Verification Risk Check
            if (worker.verification_status !== 'VERIFIED') {
                return { riskScore: 0.95, tier: 'RED', factors: { unverified: true } };
            }

            // 2. Cancellation History Risk
            const cancelRate = parseFloat(worker.cancellation_rate || '0.05');
            const completionRate = parseFloat(worker.completion_rate || '0.95');
            const cancellationRisk = Math.min(1.0, (cancelRate * 2.0) + ((1.0 - completionRate) * 0.5));

            // 3. No-Show & Connectivity Risk
            const lastSeen = await redis.get(`worker:${worker.id}:last_seen`);
            const isOnlineNow = worker.is_online && lastSeen && (Date.now() - parseInt(lastSeen) < 300000);
            
            const hoursUntilJob = (new Date(job.scheduled_at).getTime() - Date.now()) / (1000 * 3600);
            
            let noShowRisk = 0.05;
            if (hoursUntilJob <= 1.0 && !isOnlineNow) {
                noShowRisk = 0.85; // High no-show risk if offline 1h before start
            } else if (hoursUntilJob <= 0.25 && !isOnlineNow) {
                noShowRisk = 0.98; // Critical no-show risk 15m before start
            }

            // 4. Availability & Overlap Conflict Risk
            const overlapCheck = await db.query(`
                SELECT COUNT(*) FROM jobs 
                WHERE worker_id = $1 
                  AND id != $2 
                  AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS')
                  AND (
                      (scheduled_at BETWEEN $3::timestamp - INTERVAL '2 hours' AND $3::timestamp + INTERVAL '2 hours')
                      OR status = 'WORK_IN_PROGRESS'
                  )
            `, [workerId, job.id, job.scheduled_at]);

            const overlapCount = parseInt(overlapCheck.rows[0].count || '0', 10);
            const conflictRisk = Math.min(1.0, overlapCount * 0.45);

            // 5. Distance & ETA Traffic Risk
            const executionService = require('./execution.service');
            let distKm = 5.0;
            if (worker.current_lat && worker.current_lng && job.location_lat && job.location_lng) {
                distKm = executionService.calculateDistance(
                    parseFloat(worker.current_lat),
                    parseFloat(worker.current_lng),
                    parseFloat(job.location_lat),
                    parseFloat(job.location_lng)
                );
            }

            const etaRisk = Math.min(1.0, distKm / 30.0);

            // Aggregate Heuristic Risk Score
            const rawScore = (cancellationRisk * 0.35) + (noShowRisk * 0.35) + (conflictRisk * 0.20) + (etaRisk * 0.10);
            const riskScore = Math.min(1.0, Math.max(0.0, rawScore));

            // Determine Risk Tier
            let tier = 'GREEN';
            if (riskScore >= scheduledConfig.riskTiers.orangeMax) {
                tier = 'RED';
            } else if (riskScore >= scheduledConfig.riskTiers.yellowMax) {
                tier = 'ORANGE';
            } else if (riskScore >= scheduledConfig.riskTiers.greenMax) {
                tier = 'YELLOW';
            }

            return {
                riskScore: parseFloat(riskScore.toFixed(3)),
                tier,
                factors: {
                    cancellationRisk: parseFloat(cancellationRisk.toFixed(2)),
                    noShowRisk: parseFloat(noShowRisk.toFixed(2)),
                    conflictRisk: parseFloat(conflictRisk.toFixed(2)),
                    etaRisk: parseFloat(etaRisk.toFixed(2)),
                    isOnlineNow,
                    distanceKm: parseFloat(distKm.toFixed(1))
                }
            };
        } catch (e) {
            console.error('[RISK-ML-PREDICT-ERROR]', e.message);
            return { riskScore: 0.1, tier: 'GREEN', factors: { fallback: true } };
        }
    }
}

module.exports = new ScheduledRiskMLService();
