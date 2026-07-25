/**
 * Nexo Feature Flag Configuration
 */

module.exports = {
    // Cache configuration
    cacheTtlSeconds: parseInt(process.env.FEATURE_FLAG_CACHE_TTL || "3600", 10), // 1 hour
    redisNamespace: 'feature_flags:cache:',

    // Emergency global kill switches (can disable critical parts of the platform instantly)
    globalKillSwitches: {
        disablePayments: false,
        disableMLDispatch: false,
        disableNotifications: false,
        disableChat: false
    }
};
