/**
 * Nexo Backup Worker Pool Configuration
 * 
 * Centralized configurations for standby worker allocation, search parameters,
 * Redis TTL settings, escalation parameters, status mapping, and notification templates.
 */

module.exports = {
    // Default number of backup workers to reserve
    poolSize: parseInt(process.env.BACKUP_POOL_SIZE || "2", 10),

    // Number of backups to reserve automatically when a job is accepted
    autoReservePoolSize: parseInt(process.env.BACKUP_AUTO_RESERVE_POOL_SIZE || "3", 10),

    // Search radius (in km) to seek backup candidates
    searchRadiusKm: parseFloat(process.env.BACKUP_SEARCH_RADIUS_KM || "15.0"),

    // Limit of workers to fetch per matching call
    searchLimit: parseInt(process.env.BACKUP_SEARCH_LIMIT || "1", 10),

    // Expiration TTL for Redis caching of backup pool counts (seconds)
    redisTtlSeconds: parseInt(process.env.BACKUP_REDIS_TTL_SEC || "7200", 10), // 2 hours

    // Default time window (in hours) to compute historical backup metrics
    defaultMetricsHours: parseInt(process.env.BACKUP_METRICS_HOURS || "24", 10),

    // Standardized Failure Scenarios
    failureScenarios: {
        WORKER_CANCELLED: 'worker_cancelled',
        WORKER_OFFLINE: 'worker_offline',
        WORKER_UNREACHABLE: 'worker_unreachable',
        WORKER_NO_SHOW: 'worker_no_show',
        WORKER_REASSIGNED: 'worker_reassigned',
        WORKER_ETA_EXCEEDED: 'worker_eta_exceeded',
        JOB_ABANDONED: 'job_abandoned',
    },

    // Backup Worker Pool Statuses
    statuses: {
        RESERVED: 'RESERVED',
        PRIMARY_FAILED: 'PRIMARY_FAILED',
        ACTIVATED: 'ACTIVATED',
        RELEASED: 'RELEASED'
    },

    // Job Statuses in the Lifecycle
    jobStatuses: {
        OPEN: 'OPEN',
        REDISTRIBUTING: 'REDISTRIBUTING',
        REASSIGNING: 'REASSIGNING',
        ASSIGNED: 'ASSIGNED',
        ACCEPTED: 'ACCEPTED'
    },

    // Worker History Roles
    workerRoles: {
        PRIMARY: 'primary',
        BACKUP: 'backup'
    },

    // Socket.io event name mappings
    socketEvents: {
        NEW_JOB_REQUEST: 'new_job_request',
        BACKUP_WORKER_ASSIGNED: 'backup_worker_assigned',
        BACKUP_ESCALATION: 'backup_escalation'
    },

    // Centralized user and admin-facing notification messages & templates
    messaging: {
        getBackupWorkerRequestMessage: (reason) => `Backup assignment: ${reason}`,
        customerNotification: 'A backup worker has been assigned to your job.',
        getAdminEscalationMessage: (jobId, scenario) => `CRITICAL: No backup worker available for job ${jobId}. ${scenario} occurred.`
    }
};
