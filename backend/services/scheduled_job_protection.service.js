/**
 * Nexo Scheduled Job Protection Engine
 * 
 * Continuous monitoring engine for scheduled bookings:
 * - Pre-job health checks
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
     * Continuous cron monitor loop (runs based on scheduled frequency).
     */
    async monitorScheduledJobs() {
        try {
            const now = new Date();
            
            // Query upcoming active scheduled jobs using configured windows
            const lookAheadTime = new Date(now.getTime() + scheduledConfig.monitoring.lookAheadHours * 60 * 60 * 1000);
            const overdueTime = new Date(now.getTime() - scheduledConfig.monitoring.overdueGraceHours * 60 * 60 * 1000);

            const scheduledJobsRes = await db.query(`
                SELECT id, user_id, worker_id, status, category, location_lat, location_lng,
                       scheduled_at, created_at, price
                FROM jobs
                WHERE scheduled_at IS NOT NULL
                  AND scheduled_at <= $1
                  AND scheduled_at >= $2
                  AND status = ANY($3)
                ORDER BY scheduled_at ASC
            `, [lookAheadTime, overdueTime, scheduledConfig.monitoring.statuses]);

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
            // 1. Maintain & Refresh Dynamic Hidden Standby Worker Pool (Requirement 3)
            if (job.worker_id) {
                const dynamicPoolSize = this._getDynamicStandbyPoolSize(job);
                await backupWorkerService.reserveBackups(jobId, job.worker_id, dynamicPoolSize);
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
                scheduledConfig.eventTypes.healthCheck,
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
                        const reminder = scheduledConfig.messaging.workerReminder;
                        io.to(`worker:${job.worker_id}`).emit(reminder.eventName, {
                            jobId,
                            scheduledAt: job.scheduled_at,
                            minutesUntilStart,
                            urgent: reminder.urgent,
                            message: reminder.getMessage(minutesUntilStart)
                        });
                    }
                }
            }

            // 4. Overdue / No-Show Auto-Replacement at Start Time
            if (minutesUntilStart <= 0 && scheduledConfig.overdueReplacementStatuses.includes(job.status)) {
                console.log(`🚨 [NO-SHOW-TRIGGERED] Job ${jobId} reached scheduled time (${job.scheduled_at}) without worker starting navigation. Executing auto-replacement!`);
                await this.executeEmergencyReplacement(job, scheduledConfig.reasons.workerNoShow);
                return;
            }

            // 5. Proactive Replacement for configured high risk level tier (e.g. RED)
            if (riskEval.tier === scheduledConfig.proactiveReplacementTier && scheduledConfig.proactiveReplacementStatuses.includes(job.status)) {
                console.warn(`🚨 [PROACTIVE-REPLACEMENT] Job ${jobId} Risk Level ${riskEval.tier} (${riskEval.riskScore}). Triggering silent replacement!`);
                await this.executeEmergencyReplacement(job, scheduledConfig.reasons.proactiveHighRisk);
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

        // Inform customer seamlessly
        if (io) {
            const searching = scheduledConfig.messaging.searchingStatus;
            const updated = scheduledConfig.messaging.jobStatusUpdated;

            io.to(`user:${job.user_id}`).emit(searching.eventName, {
                status: searching.status,
                message: searching.message,
                isReplacement: searching.isReplacement
            });
            io.to(`user:${job.user_id}`).emit(updated.eventName, {
                jobId: job.id,
                status: updated.status,
                message: updated.message
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

    _getDynamicStandbyPoolSize(job) {
        const schedTime = new Date(job.scheduled_at);
        const day = schedTime.getDay();
        const hour = schedTime.getHours();
        
        const isWeekend = day === 0 || day === 6; // Sunday or Saturday
        const isPeakTime = (hour >= 8 && hour <= 12) || (hour >= 17 && hour <= 21);
        
        // Simulating environmental features: Rain or festival peaks via configuration / environment variables
        const weather = process.env.WEATHER || 'CLEAR';
        const isFestivalSeason = process.env.FESTIVAL === 'true';

        let poolSize = 3;
        if (isWeekend) poolSize += 2;
        if (isPeakTime) poolSize += 2;
        if (weather === 'RAIN') poolSize += 3;
        if (isFestivalSeason) poolSize += 3;

        const finalSize = Math.min(8, Math.max(2, poolSize));
        console.log(`🛡️ [DYNAMIC-STANDBY] Job ${job.id} on Day ${day} Hour ${hour} (Weather: ${weather}, Festival: ${isFestivalSeason}) assigned pool size: ${finalSize}`);
        return finalSize;
    }
}

module.exports = new ScheduledJobProtectionService();
