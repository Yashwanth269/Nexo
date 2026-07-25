/**
 * Nexo Centralized Scheduled Job Protection Engine Configuration
 * 
 * Configurable thresholds for pre-job health checkpoints, risk tiers,
 * standby pools, no-show timelines, and cancellation escalation levels.
 */

module.exports = {
    // Checkpoints before scheduled_at
    checkpoints: {
        hours: [24, 12, 6, 3, 1],
        minutes: [30, 15]
    },

    // Risk Tiers (0.0 to 1.0)
    riskTiers: {
        greenMax: parseFloat(process.env.SCHEDULED_RISK_GREEN_MAX || '0.20'),   // Risk < 20%: Normal
        yellowMax: parseFloat(process.env.SCHEDULED_RISK_YELLOW_MAX || '0.50'), // Risk 20-50%: Increased monitoring
        orangeMax: parseFloat(process.env.SCHEDULED_RISK_ORANGE_MAX || '0.70'), // Risk 50-70%: Silent standby expansion
        // Risk > 70%: RED - Proactive replacement
    },

    // No-Show Detection Timeline (Minutes before scheduled_at)
    noShowTimeline: {
        warningMinutes: parseInt(process.env.NOSHOW_WARNING_MIN || '15', 10),
        prewarmMinutes: parseInt(process.env.NOSHOW_PREWARM_MIN || '10', 10),
        standbyAlertMinutes: parseInt(process.env.NOSHOW_ALERT_MIN || '5', 10),
        autoReplaceMinutes: parseInt(process.env.NOSHOW_REPLACE_MIN || '0', 10)
    },

    // Cancellation Escalation Rules (Hours before scheduled_at)
    cancellationWindows: {
        farAdvanceHours: 24,       // >24h: Standard Redispatch
        mediumAdvanceHours: 6,     // 6-24h: High Priority
        shortAdvanceHours: 1,      // 1-6h: Emergency Recovery Mode
        // <1h or past start time: Critical Emergency Replacement
    },

    // Standby Worker Pool
    standby: {
        poolSize: parseInt(process.env.SCHEDULED_STANDBY_POOL_SIZE || '3', 10),
        refreshIntervalMinutes: parseInt(process.env.SCHEDULED_STANDBY_REFRESH_MIN || '5', 10),
        offerTtlSeconds: parseInt(process.env.SCHEDULED_STANDBY_OFFER_TTL_SEC || '20', 10)
    },

    // Scheduled Reliability Penalties
    penalties: {
        lateCancelPenaltyScore: 0.25,
        noShowPenaltyScore: 0.40,
        consecutiveNoShowLimit: 2
    },

    // Upcoming Job Monitoring Settings
    monitoring: {
        lookAheadHours: parseInt(process.env.SCHEDULED_LOOK_AHEAD_HOURS || '48', 10),
        overdueGraceHours: parseInt(process.env.SCHEDULED_OVERDUE_GRACE_HOURS || '2', 10),
        statuses: ['ACCEPTED', 'RESERVED', 'CONFIRMED', 'REDISTRIBUTING', 'OPEN']
    },

    // Replacement and Risk Tier settings
    proactiveReplacementTier: 'RED',
    proactiveReplacementStatuses: ['ACCEPTED', 'RESERVED'],
    overdueReplacementStatuses: ['ACCEPTED', 'RESERVED', 'CONFIRMED'],

    // Event type logging configuration
    eventTypes: {
        healthCheck: 'scheduled_health_check'
    },

    // Emergency replacement reasons
    reasons: {
        workerNoShow: 'WORKER_NO_SHOW',
        proactiveHighRisk: 'PROACTIVE_HIGH_RISK'
    },

    // Socket messaging event configurations & template strings
    messaging: {
        workerReminder: {
            eventName: 'scheduled_job_reminder',
            urgent: true,
            getMessage: (mins) => `⚠️ Action Required: Please turn ONLINE and confirm your upcoming job scheduled in ${mins} mins.`
        },
        searchingStatus: {
            eventName: 'searching_status',
            status: 'SEARCHING_NEARBY',
            message: "Finding another professional for your scheduled booking...",
            isReplacement: true
        },
        jobStatusUpdated: {
            eventName: 'job_status_updated',
            status: 'REDISTRIBUTING',
            message: "Finding another professional..."
        }
    }
};
