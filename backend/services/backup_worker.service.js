const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');
const metrics = require('../middleware/metrics');
const backupConfig = require('../config/backup.config');

class BackupWorkerService {
    /**
     * Reserves standby workers for a scheduled job.
     */
    async reserveBackups(jobId, primaryWorkerId, count = backupConfig.poolSize) {
        const jobStatuses = [
            backupConfig.jobStatuses.OPEN,
            backupConfig.jobStatuses.REDISTRIBUTING,
            backupConfig.jobStatuses.REASSIGNING
        ];

        const jobRes = await db.query(
            `SELECT location_lat, location_lng, category, price FROM jobs 
             WHERE id = $1 AND status = ANY($2)`,
            [jobId, jobStatuses]
        );
        if (jobRes.rowCount === 0) return [];
        const job = jobRes.rows[0];

        const matchingService = require('./matching.service');
        const workers = await matchingService.getNearbyRankedWorkers(
            job, 
            backupConfig.searchRadiusKm, 
            backupConfig.searchLimit
        );

        const backups = workers
            .filter(w => w.id !== primaryWorkerId)
            .slice(0, count);

        const reserved = [];
        for (const worker of backups) {
            await db.query(`
                INSERT INTO backup_worker_pool (
                    job_id, primary_worker_id, backup_worker_id, status, distance_km, rank_score
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (job_id, backup_worker_id) DO NOTHING
            `, [
                jobId, 
                primaryWorkerId, 
                worker.id, 
                backupConfig.statuses.RESERVED, 
                worker.distance || 0, 
                worker.score || 0
            ]);
            reserved.push(worker);
        }

        await redis.set(`backup:${jobId}:count`, reserved.length, 'EX', backupConfig.redisTtlSeconds);
        metrics.backupWorkersReserved.inc({ jobId }, reserved.length);
        return reserved;
    }

    /**
     * Automatically reserve backup pool on job acceptance.
     */
    async autoReserveOnAcceptance(jobId, primaryWorkerId) {
        return this.reserveBackups(jobId, primaryWorkerId, backupConfig.autoReservePoolSize);
    }

    /**
     * Handles failure scenarios by triggering backup workers or escalating.
     */
    async handleFailure(jobId, reason, metadata = {}) {
        const scenario = backupConfig.failureScenarios[reason] || 'unknown';
        const startTime = Date.now();

        await this._preserveJobHistory(jobId, scenario, metadata);

        const backup = await this.activateBackup(jobId, reason);

        if (backup) {
            const recoveryTimeMs = Date.now() - startTime;
            metrics.backupActivationSuccess.inc({ scenario });
            metrics.backupRecoveryTimeMs.observe(recoveryTimeMs);
            await this._logActivation(jobId, backup.backup_worker_id, scenario, recoveryTimeMs, true);
            return { success: true, backup, recoveryTimeMs };
        } else {
            metrics.backupActivationFailed.inc({ scenario });
            await this._logActivation(jobId, null, scenario, Date.now() - startTime, false);
            await this._escalateToSupport(jobId, scenario, metadata);
            return { success: false, reason: 'No backup available', escalated: true };
        }
    }

    async _preserveJobHistory(jobId, scenario, metadata) {
        await db.query(`
            INSERT INTO backup_activations (job_id, primary_worker_id, scenario, metadata, previous_status)
            SELECT j.id, j.worker_id, $1, $2, j.status
            FROM jobs j WHERE j.id = $3
        `, [scenario, JSON.stringify(metadata), jobId]);

        await db.query(`
            UPDATE backup_worker_pool SET status = $1, failed_at = NOW(), failure_reason = $2
            WHERE job_id = $3 AND status = $4
        `, [
            backupConfig.statuses.PRIMARY_FAILED, 
            scenario, 
            jobId, 
            backupConfig.statuses.RESERVED
        ]);
    }

    /**
     * Activates a backup candidate from the pool.
     */
    async activateBackup(jobId, reason) {
        const statuses = [
            backupConfig.statuses.RESERVED,
            backupConfig.statuses.PRIMARY_FAILED
        ];

        const backupRes = await db.query(
            `SELECT * FROM backup_worker_pool 
             WHERE job_id = $1 AND status = ANY($2) 
             ORDER BY rank_score DESC LIMIT 1`,
            [jobId, statuses]
        );
        if (backupRes.rowCount === 0) return null;
        const backup = backupRes.rows[0];

        await db.query(
            `UPDATE backup_worker_pool SET status = $1, activated_at = NOW() WHERE id = $2`,
            [backupConfig.statuses.ACTIVATED, backup.id]
        );
        await db.query(
            `UPDATE jobs SET worker_id = $1, status = $2, updated_at = NOW() WHERE id = $3`,
            [backup.backup_worker_id, backupConfig.jobStatuses.REDISTRIBUTING, jobId]
        );

        const workerRes = await db.query("SELECT phone_number FROM workers WHERE id = $1", [backup.backup_worker_id]);
        if (workerRes.rowCount > 0) {
            const io = getIO();
            const message = backupConfig.messaging.getBackupWorkerRequestMessage(reason);
            io.to(`worker:${workerRes.rows[0].phone_number}`).emit(backupConfig.socketEvents.NEW_JOB_REQUEST, {
                jobId,
                reason: message,
                isUrgent: true,
            });
        }
        const jobRes = await db.query("SELECT user_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount > 0) {
            const io = getIO();
            io.to(`user:${jobRes.rows[0].user_id}`).emit(backupConfig.socketEvents.BACKUP_WORKER_ASSIGNED, {
                jobId,
                reason,
                message: backupConfig.messaging.customerNotification,
            });
        }

        await this._transferJobContext(jobId, backup.backup_worker_id);
        return backup;
    }

    async _transferJobContext(jobId, newWorkerId) {
        await db.query(`
            UPDATE chat_messages SET worker_id = $1 WHERE job_id = $2
        `, [newWorkerId, jobId]);

        await db.query(`
            INSERT INTO job_worker_history (job_id, worker_id, role, assigned_at)
            VALUES ($1, $2, $3, NOW())
        `, [jobId, newWorkerId, backupConfig.workerRoles.BACKUP]);
    }

    async _logActivation(jobId, backupWorkerId, scenario, recoveryTimeMs, success) {
        await db.query(`
            INSERT INTO backup_activation_log (job_id, backup_worker_id, scenario, recovery_time_ms, success, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [jobId, backupWorkerId, scenario, recoveryTimeMs, success]);
    }

    async _escalateToSupport(jobId, scenario, metadata) {
        const jobRes = await db.query("SELECT user_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount > 0) {
            const io = getIO();
            const message = backupConfig.messaging.getAdminEscalationMessage(jobId, scenario);
            io.to('admin:support').emit(backupConfig.socketEvents.BACKUP_ESCALATION, {
                jobId,
                scenario,
                metadata,
                message: message
            });
        }
    }

    /**
     * Releases backup workers reserved for a job.
     */
    async releaseBackup(jobId) {
        const statuses = [
            backupConfig.statuses.RESERVED,
            backupConfig.statuses.PRIMARY_FAILED
        ];

        await db.query(
            `UPDATE backup_worker_pool SET status = $1 WHERE job_id = $2 AND status = ANY($3)`,
            [backupConfig.statuses.RELEASED, jobId, statuses]
        );
        await redis.del(`backup:${jobId}:count`);
    }

    /**
     * Queries status of backup workers for a job.
     */
    async getBackupStatus(jobId) {
        const res = await db.query(
            "SELECT * FROM backup_worker_pool WHERE job_id = $1 ORDER BY rank_score DESC",
            [jobId]
        );
        return res.rows;
    }

    /**
     * Fetches metrics parameterized by hours to avoid string concatenation.
     */
    async getMetrics(timeWindowHours = backupConfig.defaultMetricsHours) {
        const res = await db.query(`
            SELECT
                scenario,
                COUNT(*) as total_activations,
                SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
                AVG(recovery_time_ms) as avg_recovery_time_ms,
                MAX(recovery_time_ms) as max_recovery_time_ms
            FROM backup_activation_log
            WHERE created_at > NOW() - ($1 || ' hours')::INTERVAL
            GROUP BY scenario
        `, [timeWindowHours]);
        return res.rows;
    }
}

module.exports = new BackupWorkerService();