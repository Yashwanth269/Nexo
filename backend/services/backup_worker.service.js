const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');
const metrics = require('../middleware/metrics');

const FAILURE_SCENARIOS = {
    WORKER_CANCELLED: 'worker_cancelled',
    WORKER_OFFLINE: 'worker_offline',
    WORKER_UNREACHABLE: 'worker_unreachable',
    WORKER_NO_SHOW: 'worker_no_show',
    WORKER_REASSIGNED: 'worker_reassigned',
    WORKER_ETA_EXCEEDED: 'worker_eta_exceeded',
    JOB_ABANDONED: 'job_abandoned',
};

class BackupWorkerService {
    async reserveBackups(jobId, primaryWorkerId, count = 2) {
        const jobRes = await db.query(
            "SELECT location_lat, location_lng, category, price FROM jobs WHERE id = $1 AND status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')",
            [jobId]
        );
        if (jobRes.rowCount === 0) return [];
        const job = jobRes.rows[0];
        const matchingService = require('./matching.service');
        const workers = await matchingService.getNearbyRankedWorkers(job, 15, 1);
        const backups = workers
            .filter(w => w.id !== primaryWorkerId)
            .slice(0, count);

        const reserved = [];
        for (const worker of backups) {
            await db.query(`
                INSERT INTO backup_worker_pool (job_id, primary_worker_id, backup_worker_id, status, distance_km, rank_score)
                VALUES ($1, $2, $3, 'RESERVED', $4, $5)
                ON CONFLICT (job_id, backup_worker_id) DO NOTHING
            `, [jobId, primaryWorkerId, worker.id, worker.distance || 0, worker.score || 0]);
            reserved.push(worker);
        }
        await redis.set(`backup:${jobId}:count`, reserved.length, 'EX', 7200);
        metrics.backupWorkersReserved.inc({ jobId }, reserved.length);
        return reserved;
    }

    async autoReserveOnAcceptance(jobId, primaryWorkerId) {
        return this.reserveBackups(jobId, primaryWorkerId, 3);
    }

    async handleFailure(jobId, reason, metadata = {}) {
        const scenario = FAILURE_SCENARIOS[reason] || 'unknown';
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
            UPDATE backup_worker_pool SET status = 'PRIMARY_FAILED', failed_at = NOW(), failure_reason = $1
            WHERE job_id = $2 AND status = 'RESERVED'
        `, [scenario, jobId]);
    }

    async activateBackup(jobId, reason) {
        const backupRes = await db.query(
            "SELECT * FROM backup_worker_pool WHERE job_id = $1 AND status IN ('RESERVED', 'PRIMARY_FAILED') ORDER BY rank_score DESC LIMIT 1",
            [jobId]
        );
        if (backupRes.rowCount === 0) return null;
        const backup = backupRes.rows[0];

        await db.query(
            "UPDATE backup_worker_pool SET status = 'ACTIVATED', activated_at = NOW() WHERE id = $1",
            [backup.id]
        );
        await db.query(
            "UPDATE jobs SET worker_id = $1, status = 'REDISTRIBUTING', updated_at = NOW() WHERE id = $2",
            [backup.backup_worker_id, jobId]
        );

        const workerRes = await db.query("SELECT phone_number FROM workers WHERE id = $1", [backup.backup_worker_id]);
        if (workerRes.rowCount > 0) {
            const io = getIO();
            io.to(`worker:${workerRes.rows[0].phone_number}`).emit('new_job_request', {
                jobId,
                reason: `Backup assignment: ${reason}`,
                isUrgent: true,
            });
        }
        const jobRes = await db.query("SELECT user_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount > 0) {
            const io = getIO();
            io.to(`user:${jobRes.rows[0].user_id}`).emit('backup_worker_assigned', {
                jobId,
                reason,
                message: 'A backup worker has been assigned to your job.',
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
            VALUES ($1, $2, 'backup', NOW())
        `, [jobId, newWorkerId]);
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
            io.to('admin:support').emit('backup_escalation', {
                jobId,
                scenario,
                metadata,
                message: `CRITICAL: No backup worker available for job ${jobId}. ${scenario} occurred.`
            });
        }
    }

    async releaseBackup(jobId) {
        await db.query(
            "UPDATE backup_worker_pool SET status = 'RELEASED' WHERE job_id = $1 AND status IN ('RESERVED', 'PRIMARY_FAILED')",
            [jobId]
        );
        await redis.del(`backup:${jobId}:count`);
    }

    async getBackupStatus(jobId) {
        const res = await db.query(
            "SELECT * FROM backup_worker_pool WHERE job_id = $1 ORDER BY rank_score DESC",
            [jobId]
        );
        return res.rows;
    }

    async getMetrics(timeWindowHours = 24) {
        const res = await db.query(`
            SELECT
                scenario,
                COUNT(*) as total_activations,
                SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
                AVG(recovery_time_ms) as avg_recovery_time_ms,
                MAX(recovery_time_ms) as max_recovery_time_ms
            FROM backup_activation_log
            WHERE created_at > NOW() - INTERVAL '${timeWindowHours} hours'
            GROUP BY scenario
        `);
        return res.rows;
    }
}

module.exports = new BackupWorkerService();