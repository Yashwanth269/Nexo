/**
 * Nexo Scheduled Job Protection Engine
 * 
 * Continuous monitoring engine for scheduled bookings:
 * - Pre-job health checks (24h, 12h, 6h, 3h, 1h, 30m, 15m)
 * - Hidden standby worker pool reservation & refresh
 * - No-Show watch and automatic replacement at scheduled_at
 * - Emergency reassignment without customer service disruption
 */

const db = require('../config/db');
const redis = require('../config/redis');
const scheduledConfig = require('../config/scheduled.config');
const riskService = require('./scheduled_risk_ml.service');
const backupWorkerService = require('./backup_worker.service');
const { getIO } = require('../config/socket');

class ScheduledJobProtectionService {
    /**
     * Continuous cron monitor loop (runs every 2 minutes).
     */
    async monitorScheduledJobs() {
        try {
            const now = new Date();
            
            // Query upcoming active scheduled jobs (within next 48 hours or overdue by < 2 hours)
            const scheduledJobsRes = await db.query(`
                SELECT id, user_id, worker_id, status, category, location_lat, location_lng,
                       scheduled_at, created_at, price
                FROM jobs
                WHERE scheduled_at IS NOT NULL
                  AND scheduled_at <= NOW() + INTERVAL '48 hours'
                  AND scheduled_at >= NOW() - INTERVAL '2 hours'
                  AND status IN ('ACCEPTED', 'RESERVED', 'CONFIRMED', 'REDISTRIBUTING', 'OPEN')
                ORDER BY scheduled_at ASC
            `);

            const jobs = scheduledJobsRes.rows;
            if (jobs.length === 0) return;

            console.log(`🛡️ [SCHEDULED-PROTECTION] Monitoring ${jobs.length} scheduled job(s)...`);

            for (const job of jobs) {
                await this.processJobProtection(job);
            }
        } catch (e) {
            console.error('🛡️ [SCHEDULED-PROTECTION-ERROR]', e.message);
        }
    }

    /**
     * Processes individual scheduled job protection lifecycle.
     */
    async processJobProtection(job) {
        const jobId = job.id;
        const nowMs = Date.now();
        const scheduledMs = new Date(job.scheduled_at).getTime();
        const minutesUntilStart = Math.round((scheduledMs - nowMs) / 60000.0);

        try {
            // 1. Maintain & Refresh Hidden Standby Worker Pool
            if (job.worker_id) {
                await backupWorkerService.reserveBackups(jobId, job.worker_id, scheduledConfig.standby.poolSize);
            }

            // 2. Pre-Job Health & Risk Evaluation
            const riskEval = await riskService.predictReservationRisk(job, job.worker_id);

            // Log risk evaluation to event_logs
            await db.query(`
                INSERT INTO event_logs (job_id, worker_id, user_id, event_type, metadata)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                jobId,
                job.worker_id,
                job.user_id,
                'scheduled_health_check',
                JSON.stringify({
                    minutesUntilStart,
                    riskScore: riskEval.riskScore,
                    tier: riskEval.tier,
                    factors: riskEval.factors,
                    timestamp: new Date().toISOString()
                })
            ]);

            // 3. No-Show Watch & Auto-Replacement Engine
            if (minutesUntilStart <= scheduledConfig.noShowTimeline.warningMinutes && minutesUntilStart > 0) {
                // Check if worker is offline or inactive
                if (!riskEval.factors?.isOnlineNow) {
                    console.warn(`⚠️ [NO-SHOW-WATCH] Job ${jobId}: Worker ${job.worker_id} is offline ${minutesUntilStart}m before scheduled start!`);
                    
                    const io = getIO();
                    if (io && job.worker_id) {
                        io.to(`worker:${job.worker_id}`).emit('scheduled_job_reminder', {
                            jobId,
                            scheduledAt: job.scheduled_at,
                            minutesUntilStart,
                            urgent: true,
                            message: `⚠️ Action Required: Please turn ONLINE and confirm your upcoming job scheduled in ${minutesUntilStart} mins.`
                        });
                    }
                }
            }

            // 4. Overdue / No-Show Auto-Replacement at Start Time
            if (minutesUntilStart <= 0 && ['ACCEPTED', 'RESERVED', 'CONFIRMED'].includes(job.status)) {
                console.log(`🚨 [NO-SHOW-TRIGGERED] Job ${jobId} reached scheduled time (${job.scheduled_at}) without worker starting navigation. Executing auto-replacement!`);
                await this.executeEmergencyReplacement(job, 'WORKER_NO_SHOW');
                return;
            }

            // 5. Proactive Replacement for RED Risk Level (>70%)
            if (riskEval.tier === 'RED' && ['ACCEPTED', 'RESERVED'].includes(job.status)) {
                console.warn(`🚨 [PROACTIVE-REPLACEMENT] Job ${jobId} Risk Level RED (${riskEval.riskScore}). Triggering silent replacement!`);
                await this.executeEmergencyReplacement(job, 'PROACTIVE_HIGH_RISK');
                return;
            }

        } catch (jobErr) {
            console.error(`🛡️ [SCHEDULED-PROTECTION-JOB-ERROR] Job ${jobId}:`, jobErr.message);
        }
    }

    /**
     * Executes instant standby activation or emergency replacement.
     */
    async executeEmergencyReplacement(job, reason) {
        const io = getIO();

        // Inform customer seamlessly: "We're finding another professional..."
        if (io) {
            io.to(`user:${job.user_id}`).emit('searching_status', {
                status: 'SEARCHING_NEARBY',
                message: "Finding another professional for your scheduled booking...",
                isReplacement: true
            });
            io.to(`user:${job.user_id}`).emit('job_status_updated', {
                jobId: job.id,
                status: 'REDISTRIBUTING',
                message: "Finding another professional..."
            });
        }

        // Try activating standby candidate
        const backupResult = await backupWorkerService.handleFailure(job.id, reason, {
            previousWorkerId: job.worker_id,
            scheduledAt: job.scheduled_at
        });

        if (backupResult && backupResult.success) {
            console.log(`✅ [SCHEDULED-RESCUE-SUCCESS] Job ${job.id} reassigned to standby worker ${backupResult.backup.backup_worker_id}`);
        } else {
            console.log(`🚨 [SCHEDULED-RESCUE-EXPAND] Standby pool exhausted for Job ${job.id}. Launching emergency dispatch pipeline...`);
            const matchingService = require('./matching.service');
            await matchingService.runDispatchPipeline(job.id);
        }
    }
}

module.exports = new ScheduledJobProtectionService();
