/**
 * Nexo Audit Log Service Configuration
 * 
 * Configurable thresholds, query limits, retention policies,
 * and standardized constants/enums for audit logs.
 */

module.exports = {
    defaults: {
        // Default number of records returned in queries
        queryLimit: parseInt(process.env.AUDIT_DEFAULT_LIMIT || "50", 10),
        
        // Maximum allowed limits in query requests
        maxQueryLimit: parseInt(process.env.AUDIT_MAX_LIMIT || "500", 10),

        // Default time window for recent activity query (in hours)
        recentActivityHours: parseInt(process.env.AUDIT_RECENT_HOURS || "24", 10),

        // Default retention period for old log cleanup (in days)
        retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || "90", 10)
    },

    // Standardized Actor Types
    actorTypes: {
        ADMIN: "ADMIN",
        USER: "USER",
        WORKER: "WORKER",
        SYSTEM: "SYSTEM"
    },

    // Standardized Entity Types
    entityTypes: {
        USER: "USER",
        PAYOUT: "PAYOUT",
        DISPUTE: "DISPUTE",
        TRUST_SCORE: "TRUST_SCORE",
        JOB: "JOB"
    },

    // Standardized Audit Actions
    actions: {
        PAYOUT_COMPLETED: "PAYOUT_COMPLETED",
        PAYOUT_FAILED: "PAYOUT_FAILED",
        TRUST_SCORE_CHANGE: "TRUST_SCORE_CHANGE",
        DISPUTE_PREFIX: "DISPUTE_",
        BAN_PREFIX: "BAN_"
    }
};
