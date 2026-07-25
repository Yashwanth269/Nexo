/**
 * Nexo Marketplace Control Tower Configurations
 */

module.exports = {
    // Latency and connection alarms
    thresholds: {
        maxRedisLatencyMs: 10,
        maxDbLatencyMs: 50,
        failedDispatchAlarmPercent: 2.0
    },

    // Metrics weighting formulas
    weights: {
        redis: 0.1,
        db: 0.1,
        socket: 0.2,
        dispatch: 0.6
    }
};
