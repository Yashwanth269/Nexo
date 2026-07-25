/**
 * Nexo Dispatch Orchestrator Centralized Settings
 */

module.exports = {
    // Dynamic pool scaling default boundaries
    defaultPoolSizes: {
        poolA: 3,
        poolB: 5
    },
    emergencyPoolSizes: {
        poolA: 8,
        poolB: 12
    },

    // Redis lock prefix and key structure
    redisKeys: {
        getAcceptLockKey: (jobId) => `lock:accept_job:${jobId}`,
        getTraceKey: (jobId) => `dispatch:trace:${jobId}`
    },

    // In-memory or Redis trace cache TTL (seconds)
    traceExpirySeconds: parseInt(process.env.DISPATCH_TRACE_EXPIRY_SEC || "86400", 10), // 24 hours

    // Multi-factor ranking weights configuration
    rankingWeights: {
        distance: 0.18,
        traffic: 0.08,
        reliability: 0.15,
        custPref: 0.10,
        areaPref: 0.07,
        acceptPred: 0.12,
        direction: 0.08,
        experience: 0.07,
        fairness: 0.05,
        bundle: 0.05,
        calendarFit: 0.10
    }
};
